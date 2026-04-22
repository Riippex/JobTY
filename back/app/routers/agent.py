"""Agent control router.

POST /agent/start   — start the autonomous bot in the background
POST /agent/stop    — request a graceful stop
GET  /agent/status  — return current agent state
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db import Profile
from app.services.agent_runner import get_status, start_agent, stop_agent

logger = logging.getLogger(__name__)

router = APIRouter(tags=["agent"])


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class StartRequest(BaseModel):
    profile_name: str


class AgentStatusResponse(BaseModel):
    status: str
    current_job: dict | None
    jobs_applied: int
    errors: list[str]
    started_at: str | None
    stopped_at: str | None
    profile: str | None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/start", status_code=status.HTTP_202_ACCEPTED)
async def start(
    payload: StartRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Start the agent for *profile_name*.

    Returns 409 if the agent is already running.
    Returns 404 if the profile does not exist.
    The agent runs in the background — this endpoint returns immediately.
    """
    current = get_status()
    if current["status"] == "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Agent is already running. Call POST /agent/stop first.",
        )

    # Verify the profile exists before launching
    result = await db.execute(
        select(Profile).where(Profile.name == payload.profile_name)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile '{payload.profile_name}' not found",
        )

    asyncio.create_task(start_agent(payload.profile_name))
    logger.info("Agent task created for profile '%s'", payload.profile_name)

    return {"detail": f"Agent started for profile '{payload.profile_name}'"}


@router.post("/stop", status_code=status.HTTP_200_OK)
async def stop() -> dict[str, str]:
    """Request the running agent to stop gracefully.

    Returns 409 if the agent is not currently running.
    """
    current = get_status()
    if current["status"] not in ("running",):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Agent is not running (current status: {current['status']})",
        )

    await stop_agent()
    return {"detail": "Stop signal sent — agent will finish its current job and halt"}


@router.get("/status", response_model=AgentStatusResponse)
async def agent_status() -> AgentStatusResponse:
    """Return the current agent state."""
    return AgentStatusResponse(**get_status())
