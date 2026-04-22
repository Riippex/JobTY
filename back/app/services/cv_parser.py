"""CV parsing service.

Extracts structured data from a PDF CV using the LLM.
Results are cached in the cv_cache table keyed by PDF SHA-256 hash so the
LLM is never called twice for the same file.
"""

import hashlib
import logging
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import CVCache, Profile
from app.services.llm_provider import get_llm_provider

logger = logging.getLogger(__name__)

PROFILES_DIR = Path("data/profiles")

# ------------------------------------------------------------------
# Output schema
# ------------------------------------------------------------------


class CVParsed(BaseModel):
    skills: list[str]
    """Technical skills: languages, frameworks, tools, cloud platforms, etc."""

    languages: list[str]
    """Human languages (e.g. English, Spanish)."""

    experience_years: int
    """Estimated total years of professional experience."""

    education: list[str]
    """Degrees, diplomas, or significant certifications."""

    summary: str
    """2-3 sentence professional summary."""


# ------------------------------------------------------------------
# Prompts
# ------------------------------------------------------------------

_SYSTEM_PROMPT = """You are an expert technical recruiter who analyses CVs precisely.
Extract structured information from the CV text provided.
Respond ONLY with a valid JSON object — no markdown, no explanation, no code fences.

JSON schema you must follow exactly:
{
  "skills": ["string"],
  "languages": ["string"],
  "experience_years": integer,
  "education": ["string"],
  "summary": "string"
}

Few-shot example output:
{
  "skills": ["Python", "FastAPI", "PostgreSQL", "Docker", "React"],
  "languages": ["English", "Spanish"],
  "experience_years": 5,
  "education": ["BSc Computer Science — University of Granada"],
  "summary": "Full-stack engineer with 5 years experience building web applications. Strong backend focus on Python/FastAPI with frontend exposure to React. Comfortable with cloud deployments on AWS."
}"""


def _build_prompt(cv_text: str) -> str:
    return (
        "Analyse the following CV and extract the required information.\n\n"
        f"CV TEXT:\n{cv_text}\n\n"
        "Return the JSON object now."
    )


# ------------------------------------------------------------------
# PDF helpers
# ------------------------------------------------------------------


def _read_pdf(path: Path) -> str:
    """Extract all text from a PDF using pdfplumber."""
    pages: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                pages.append(text)
    return "\n".join(pages)


def _pdf_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------


async def parse_cv(profile_name: str, db: AsyncSession) -> CVParsed:
    """Parse the CV for *profile_name* and return structured data.

    Uses cv_cache to avoid redundant LLM calls.
    Raises FileNotFoundError if no CV has been uploaded for the profile.
    Raises ValueError if the profile does not exist.
    """
    # Resolve profile
    result = await db.execute(select(Profile).where(Profile.name == profile_name))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise ValueError(f"Profile '{profile_name}' not found")

    cv_path = PROFILES_DIR / profile_name / "cv.pdf"
    if not cv_path.exists():
        raise FileNotFoundError(f"No CV found for profile '{profile_name}'")

    pdf_hash = _pdf_hash(cv_path)

    # Check cache — same profile + same file hash = no LLM call needed
    cache_result = await db.execute(
        select(CVCache).where(
            CVCache.profile_id == profile.id,
            CVCache.pdf_hash == pdf_hash,
        )
    )
    cache_row = cache_result.scalar_one_or_none()

    if cache_row is not None and cache_row.parsed_json.get("parsed"):
        logger.debug("cv_cache hit for profile='%s' hash=%s", profile_name, pdf_hash[:12])
        return CVParsed.model_validate(cache_row.parsed_json)

    # No usable cache — call the LLM
    logger.debug("cv_cache miss for profile='%s', calling LLM", profile_name)
    cv_text = _read_pdf(cv_path)
    prompt = _build_prompt(cv_text)

    provider = get_llm_provider()
    parsed: CVParsed = await provider.complete_structured(
        prompt, CVParsed, system=_SYSTEM_PROMPT
    )

    # Persist to cache
    serialised = parsed.model_dump()
    serialised["parsed"] = True  # flag checked by profiles router

    now = datetime.now(timezone.utc)

    # Upsert: if a row exists for this profile (different hash), update it
    existing_result = await db.execute(
        select(CVCache).where(CVCache.profile_id == profile.id)
    )
    existing = existing_result.scalar_one_or_none()

    if existing is None:
        cache_entry = CVCache(
            profile_id=profile.id,
            pdf_hash=pdf_hash,
            parsed_json=serialised,
            parsed_at=now,
        )
        db.add(cache_entry)
    else:
        existing.pdf_hash = pdf_hash
        existing.parsed_json = serialised
        existing.parsed_at = now

    await db.commit()
    return parsed
