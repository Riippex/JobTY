"""Job history router.

GET /jobs?profile=<name> — list persisted jobs scoped to a single profile
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db import Job, Profile
from app.models.job import JobResponse, serialize_job

router = APIRouter(tags=["jobs"])


@router.get("", response_model=list[JobResponse])
async def list_jobs(
    profile: str = Query(..., min_length=1, description="Profile name"),
    db: AsyncSession = Depends(get_db),
) -> list[JobResponse]:
    """Return persisted jobs for *profile* ordered newest first.

    Returns 404 when the requested profile does not exist so callers can
    distinguish an unknown profile from an existing profile with empty history.
    """
    profile_result = await db.execute(select(Profile).where(Profile.name == profile))
    profile_row = profile_result.scalar_one_or_none()
    if profile_row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile '{profile}' not found",
        )

    jobs_result = await db.execute(
        select(Job)
        .where(Job.profile_id == profile_row.id)
        .order_by(Job.created_at.desc(), Job.id.desc())
    )
    jobs = jobs_result.scalars().all()
    return [serialize_job(job) for job in jobs]
