"""Agent control router.

POST /agent/start   — start the autonomous bot in the background
POST /agent/stop    — request a graceful stop
GET  /agent/status  — return current agent state
"""

import asyncio
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db import Profile
from app.services.agent_runner import get_status, start_agent, stop_agent
from app.services.session_manager import SessionManager

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


# ---------------------------------------------------------------------------
# Board login (manual OAuth / session cookie flow)
# ---------------------------------------------------------------------------

_VALID_BOARDS = {"indeed", "computrabajo"}


@router.get("/login/{board}")
async def board_login_status(board: str) -> dict:
    """Return connection status for a job board."""
    if board not in _VALID_BOARDS:
        raise HTTPException(status_code=404, detail=f"Unknown board: {board}")

    sm = SessionManager(board)
    connected = sm.exists_and_fresh()
    exp = sm.expires_at() if connected else None
    return {
        "board": board,
        "connected": connected,
        "expires_at": datetime.fromtimestamp(exp, tz=UTC).isoformat() if exp else None,
    }


@router.post("/login/{board}")
async def login_board(board: str) -> dict:
    """Open a browser window for the user to log in, then save session cookies.

    Blocks until login completes (up to 5 minutes).
    """
    if board not in _VALID_BOARDS:
        raise HTTPException(status_code=404, detail=f"Unknown board: {board}")

    try:
        if board == "indeed":
            from app.plugins.indeed import IndeedBoard  # noqa: PLC0415
            await asyncio.wait_for(IndeedBoard().manual_login(), timeout=310)
        elif board == "computrabajo":
            from app.plugins.computrabajo import ComputrabajoBoard  # noqa: PLC0415
            await asyncio.wait_for(ComputrabajoBoard().manual_login(), timeout=310)
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_408_REQUEST_TIMEOUT,
            detail="Login window timed out — please try again",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"ok": True, "board": board}


@router.delete("/login/{board}")
async def logout_board(board: str) -> dict:
    """Invalidate the saved session for a job board."""
    if board not in _VALID_BOARDS:
        raise HTTPException(status_code=404, detail=f"Unknown board: {board}")

    SessionManager(board).invalidate()
    return {"ok": True, "board": board}