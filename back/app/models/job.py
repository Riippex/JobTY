import json
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.db import Job

JobStatus = Literal["applied", "skipped", "pending", "error"]
_VALID_JOB_STATUSES: set[str] = {"applied", "skipped", "pending", "error"}


class JobCreate(BaseModel):
    url: str
    company: str
    title: str
    score: int | None = None
    status: JobStatus = "pending"


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    url: str
    company: str
    title: str
    score: int | None
    status: JobStatus
    reason: str | None = None
    applied_at: datetime | None
    created_at: datetime


class JobUpdate(BaseModel):
    score: int | None = None
    status: JobStatus | None = None
    applied_at: datetime | None = None


def _normalize_legacy_status(raw_status: str) -> tuple[JobStatus, str | None]:
    """Map stored Job.status into a valid API status without mutating DB rows.

    Legacy job_scorer rows persisted JSON score breakdowns inside ``jobs.status``.
    Those rows are exposed as ``pending`` (never ``applied``) with a readable
    reason summary until M1 migrates them into dedicated evaluation columns.
    """
    if raw_status in _VALID_JOB_STATUSES:
        return raw_status, None  # type: ignore[return-value]

    try:
        parsed = json.loads(raw_status)
    except (json.JSONDecodeError, TypeError):
        parsed = None

    if isinstance(parsed, dict):
        parts: list[str] = []
        recommendation = parsed.get("recommendation")
        if isinstance(recommendation, str) and recommendation.strip():
            parts.append(f"Recommendation: {recommendation.strip()}")

        reasons = parsed.get("reasons")
        if isinstance(reasons, list) and reasons:
            parts.append("; ".join(str(item) for item in reasons if item))

        concerns = parsed.get("concerns")
        if isinstance(concerns, list) and concerns:
            parts.append("Concerns: " + "; ".join(str(item) for item in concerns if item))

        summary = " | ".join(parts) if parts else "Legacy score payload (unmigrated)"
        return "pending", summary

    return "pending", f"Legacy status: {raw_status}"


def serialize_job(job: Job) -> JobResponse:
    """Build a truthful JobResponse from an ORM Job row."""
    normalized_status, reason = _normalize_legacy_status(job.status)
    return JobResponse(
        id=job.id,
        profile_id=job.profile_id,
        url=job.url,
        company=job.company,
        title=job.title,
        score=job.score,
        status=normalized_status,
        reason=reason,
        applied_at=job.applied_at,
        created_at=job.created_at,
    )
