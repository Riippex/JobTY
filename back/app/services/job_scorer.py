"""Job scoring service.

Evaluates how well a job offer matches the active profile's CV.
Score is persisted back to the jobs table and the full breakdown is
returned as a JobScore Pydantic model.
"""

import json
import logging
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import CVCache, Job, Profile
from app.services.llm_provider import get_llm_provider

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# Output schema
# ------------------------------------------------------------------


class JobScore(BaseModel):
    score: int
    """Fit score from 0 (no match) to 100 (perfect match)."""

    reasons: list[str]
    """Positive matching points."""

    concerns: list[str]
    """Gaps or potential red flags."""

    recommendation: Literal["apply", "skip", "maybe"]


# ------------------------------------------------------------------
# Prompts
# ------------------------------------------------------------------

_SYSTEM_PROMPT = """You are a senior technical recruiter evaluating job fit.
Given a candidate profile and a job description, return a JSON fit score.
Respond ONLY with a valid JSON object — no markdown, no explanation, no code fences.

JSON schema you must follow exactly:
{
  "score": integer (0-100),
  "reasons": ["string"],
  "concerns": ["string"],
  "recommendation": "apply" | "skip" | "maybe"
}

Scoring guide:
- 80-100 → strong match, recommend "apply"
- 50-79  → partial match, recommend "maybe"
- 0-49   → poor match, recommend "skip"

Few-shot example output:
{
  "score": 82,
  "reasons": ["Python and FastAPI are core requirements and match candidate skills", "5 years experience meets the 3+ years requirement"],
  "concerns": ["Job requires AWS certification which candidate does not hold"],
  "recommendation": "apply"
}"""


def _build_prompt(
    job_title: str,
    job_description: str,
    cv_summary: str,
) -> str:
    return (
        f"CANDIDATE PROFILE:\n{cv_summary}\n\n"
        f"JOB TITLE: {job_title}\n\n"
        f"JOB DESCRIPTION:\n{job_description}\n\n"
        "Evaluate the fit and return the JSON score object now."
    )


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------


async def score_job(
    job_url: str,
    job_title: str,
    job_description: str,
    profile_name: str,
    db: AsyncSession,
) -> JobScore:
    """Score a job offer against the profile's parsed CV.

    - If the job row already has a score stored, returns the cached result.
    - If no parsed CV exists for the profile, returns a neutral score-50 result.
    - Otherwise calls the LLM and persists the score to the jobs table.
    """
    # Resolve profile
    profile_result = await db.execute(
        select(Profile).where(Profile.name == profile_name)
    )
    profile = profile_result.scalar_one_or_none()
    if profile is None:
        raise ValueError(f"Profile '{profile_name}' not found")

    # Check if this job URL has already been scored for this profile
    job_result = await db.execute(
        select(Job).where(Job.profile_id == profile.id, Job.url == job_url)
    )
    job_row = job_result.scalar_one_or_none()

    if job_row is not None and job_row.score is not None:
        logger.debug("job score cache hit for url=%s profile=%s", job_url, profile_name)
        # Reconstruct JobScore from status field (stored as JSON string)
        try:
            stored = json.loads(job_row.status)
            if isinstance(stored, dict) and "score" in stored:
                return JobScore.model_validate(stored)
        except (json.JSONDecodeError, ValueError):
            pass
        # Fallback: build a minimal object from the stored score
        return JobScore(
            score=job_row.score,
            reasons=[],
            concerns=[],
            recommendation=_score_to_recommendation(job_row.score),
        )

    # Try to load the candidate's parsed CV from cache
    cv_result = await db.execute(
        select(CVCache).where(CVCache.profile_id == profile.id)
    )
    cv_cache = cv_result.scalar_one_or_none()

    if cv_cache is None or not cv_cache.parsed_json.get("parsed"):
        logger.warning(
            "No parsed CV for profile '%s', returning default score=50", profile_name
        )
        return JobScore(
            score=50,
            reasons=[],
            concerns=["CV has not been parsed yet — upload and parse a CV for a real score"],
            recommendation="maybe",
        )

    # Build a text summary of the candidate for the prompt
    cv_data = cv_cache.parsed_json
    cv_summary = (
        f"Summary: {cv_data.get('summary', 'N/A')}\n"
        f"Skills: {', '.join(cv_data.get('skills', []))}\n"
        f"Experience: {cv_data.get('experience_years', '?')} years\n"
        f"Education: {', '.join(cv_data.get('education', []))}\n"
        f"Languages: {', '.join(cv_data.get('languages', []))}"
    )

    prompt = _build_prompt(job_title, job_description, cv_summary)
    provider = get_llm_provider()
    job_score: JobScore = await provider.complete_structured(
        prompt, JobScore, system=_SYSTEM_PROMPT
    )

    # Persist score back to the job row (or create one if it doesn't exist yet)
    score_json = job_score.model_dump_json()

    if job_row is not None:
        job_row.score = job_score.score
        job_row.status = score_json
    else:
        new_job = Job(
            profile_id=profile.id,
            url=job_url,
            title=job_title,
            company="",  # caller can update via jobs router if needed
            score=job_score.score,
            status=score_json,
        )
        db.add(new_job)

    await db.commit()
    return job_score


def _score_to_recommendation(score: int) -> Literal["apply", "skip", "maybe"]:
    if score >= 80:
        return "apply"
    if score >= 50:
        return "maybe"
    return "skip"
