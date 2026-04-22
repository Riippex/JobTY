"""Agent runner — orchestrates the autonomous job-application bot.

This module owns the global agent state (singleton) and exposes
start_agent / stop_agent / get_status as the public interface.

The agent loop:
  1. Load the active profile from the DB.
  2. Instantiate enabled job-board plugins (ENABLED_BOARDS env var).
  3. For each board: search → score each listing → apply if score >= threshold.
  4. Emit WebSocket events at every significant step.
  5. Persist applied jobs to the DB.
  6. Stop when MAX_APPLICATIONS_PER_RUN is reached or status flips to
     "stopping".

Environment variables:
    ENABLED_BOARDS            — comma-separated list, e.g. "linkedin,indeed"
    MAX_APPLICATIONS_PER_RUN  — hard cap per run (default 5)
    APPLY_SCORE_THRESHOLD     — minimum score to apply (default 70)
"""

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models.db import Job, Profile
from app.plugins.base_board import BaseJobBoard, CaptchaDetectedError, JobListing
from app.services.job_scorer import score_job

logger = logging.getLogger(__name__)

AgentStatus = Literal["idle", "running", "stopping", "stopped", "error"]

# ---------------------------------------------------------------------------
# Singleton state
# ---------------------------------------------------------------------------

_state: dict = {
    "status": "idle",
    "current_job": None,
    "jobs_applied": 0,
    "errors": [],
    "started_at": None,
    "stopped_at": None,
    "profile": None,
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _env_max_apps() -> int:
    return int(os.getenv("MAX_APPLICATIONS_PER_RUN", "5"))


def _env_threshold() -> int:
    return int(os.getenv("APPLY_SCORE_THRESHOLD", "70"))


def _enabled_boards() -> list[str]:
    raw = os.getenv("ENABLED_BOARDS", "linkedin,indeed")
    return [b.strip().lower() for b in raw.split(",") if b.strip()]


def _build_plugins() -> list[BaseJobBoard]:
    """Instantiate plugins for every board listed in ENABLED_BOARDS."""
    boards: list[BaseJobBoard] = []
    enabled = _enabled_boards()

    if "linkedin" in enabled:
        try:
            from app.plugins.linkedin import LinkedInBoard  # noqa: PLC0415
            boards.append(LinkedInBoard())
            logger.debug("LinkedIn plugin loaded")
        except Exception as exc:
            logger.warning("Could not load LinkedIn plugin: %s", exc)

    if "indeed" in enabled:
        try:
            from app.plugins.indeed import IndeedBoard  # noqa: PLC0415
            boards.append(IndeedBoard())
            logger.debug("Indeed plugin loaded")
        except Exception as exc:
            logger.warning("Could not load Indeed plugin: %s", exc)

    return boards


async def _broadcast(event: dict) -> None:
    """Emit a WebSocket event to all connected clients.

    Import is deferred to avoid a circular import between main.py and
    this module.
    """
    try:
        from app.main import broadcast  # noqa: PLC0415
        await broadcast(event)
    except Exception as exc:
        # WebSocket broadcast must never crash the agent loop
        logger.debug("broadcast error (non-fatal): %s", exc)


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_status() -> dict:
    """Return a snapshot of the current agent state."""
    return {
        "status": _state["status"],
        "current_job": _state["current_job"],
        "jobs_applied": _state["jobs_applied"],
        "errors": list(_state["errors"]),
        "started_at": _state["started_at"],
        "stopped_at": _state["stopped_at"],
        "profile": _state["profile"],
    }


async def stop_agent() -> None:
    """Request the running agent to stop gracefully."""
    if _state["status"] == "running":
        _state["status"] = "stopping"
        logger.info("Agent stop requested")
        await _broadcast(
            {
                "type": "status",
                "data": {"status": "stopping", "jobs_applied": _state["jobs_applied"]},
                "timestamp": _ts(),
            }
        )


async def start_agent(profile_name: str) -> None:
    """Entry point for the background agent task.

    Loads the profile, iterates over boards, scores and applies to jobs,
    then transitions to "stopped" when done.

    This function is designed to run inside asyncio.create_task() —
    it manages its own DB session internally.
    """
    if _state["status"] == "running":
        logger.warning("start_agent called while already running — ignoring")
        return

    # Reset state
    _state.update(
        {
            "status": "running",
            "current_job": None,
            "jobs_applied": 0,
            "errors": [],
            "started_at": _ts(),
            "stopped_at": None,
            "profile": profile_name,
        }
    )

    await _broadcast(
        {
            "type": "status",
            "data": {"status": "running", "jobs_applied": 0},
            "timestamp": _ts(),
        }
    )
    logger.info("Agent started for profile '%s'", profile_name)

    try:
        async with AsyncSessionLocal() as db:
            await _run_loop(profile_name, db)
    except Exception as exc:
        logger.exception("Agent run failed with unexpected error: %s", exc)
        _state["status"] = "error"
        _state["errors"].append(str(exc))
        await _broadcast(
            {
                "type": "error",
                "data": {"message": f"Agent crashed: {exc}"},
                "timestamp": _ts(),
            }
        )
    finally:
        if _state["status"] not in ("error",):
            _state["status"] = "stopped"
        _state["stopped_at"] = _ts()
        await _broadcast(
            {
                "type": "status",
                "data": {
                    "status": _state["status"],
                    "jobs_applied": _state["jobs_applied"],
                },
                "timestamp": _ts(),
            }
        )
        logger.info(
            "Agent finished — status=%s jobs_applied=%d",
            _state["status"],
            _state["jobs_applied"],
        )


# ---------------------------------------------------------------------------
# Internal loop
# ---------------------------------------------------------------------------


async def _run_loop(profile_name: str, db: AsyncSession) -> None:
    """Main agent work loop — runs inside the open DB session."""
    max_apps = _env_max_apps()
    threshold = _env_threshold()

    # Load the profile
    result = await db.execute(
        select(Profile).where(Profile.name == profile_name)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        raise ValueError(f"Profile '{profile_name}' not found in DB")

    preferences = profile.preferences or {}
    keywords: list[str] = preferences.get("keywords", [])
    locations: list[str] = preferences.get("locations", [])
    remote_only: bool = preferences.get("remote_only", False)

    cv_path = f"data/profiles/{profile_name}/cv.pdf"

    plugins = _build_plugins()
    if not plugins:
        logger.warning("No job-board plugins available — agent will not run")
        await _broadcast(
            {
                "type": "error",
                "data": {"message": "No job-board plugins available"},
                "timestamp": _ts(),
            }
        )
        return

    # Populate registry so _process_job can look up boards by source name
    _register_plugins(plugins)

    for board in plugins:
        if _state["status"] == "stopping":
            logger.info("Agent stopping — skipping remaining boards")
            break

        if _state["jobs_applied"] >= max_apps:
            logger.info("MAX_APPLICATIONS_PER_RUN reached — stopping")
            break

        board_name = type(board).__name__
        logger.info("Searching on %s …", board_name)

        try:
            listings = await board.search(keywords, locations, remote_only)
        except CaptchaDetectedError as exc:
            logger.warning("CAPTCHA on %s — stopping agent: %s", board_name, exc)
            _state["errors"].append(str(exc))
            await _broadcast(
                {
                    "type": "error",
                    "data": {"message": str(exc)},
                    "timestamp": _ts(),
                }
            )
            _state["status"] = "stopping"
            break
        except Exception as exc:
            logger.error("Search on %s failed: %s", board_name, exc)
            _state["errors"].append(str(exc))
            await _broadcast(
                {
                    "type": "error",
                    "data": {"message": f"{board_name} search error: {exc}"},
                    "timestamp": _ts(),
                }
            )
            continue

        for job in listings:
            if _state["status"] == "stopping":
                break

            if _state["jobs_applied"] >= max_apps:
                break

            await _process_job(job, profile, cv_path, preferences, db, threshold)


async def _process_job(
    job: JobListing,
    profile: Profile,
    cv_path: str,
    profile_data: dict,
    db: AsyncSession,
    threshold: int,
) -> None:
    """Score a single listing, apply if above threshold, persist result."""
    profile_name = profile.name

    # Announce discovery
    _state["current_job"] = {"title": job.title, "company": job.company, "url": job.url}
    await _broadcast(
        {
            "type": "job_found",
            "data": {
                "title": job.title,
                "company": job.company,
                "url": job.url,
                "source": job.source,
            },
            "timestamp": _ts(),
        }
    )

    # Score
    try:
        job_score = await score_job(
            job_url=job.url,
            job_title=job.title,
            job_description=job.description,
            profile_name=profile_name,
            db=db,
        )
    except Exception as exc:
        logger.warning("Scoring failed for %s: %s — using score=0", job.url, exc)
        from app.services.job_scorer import JobScore  # noqa: PLC0415
        job_score = JobScore(score=0, reasons=[], concerns=[str(exc)], recommendation="skip")

    await _broadcast(
        {
            "type": "job_scored",
            "data": {
                "title": job.title,
                "company": job.company,
                "score": job_score.score,
                "recommendation": job_score.recommendation,
            },
            "timestamp": _ts(),
        }
    )

    if job_score.score < threshold:
        await _broadcast(
            {
                "type": "skipped",
                "data": {
                    "title": job.title,
                    "company": job.company,
                    "score": job_score.score,
                    "reason": "score too low",
                },
                "timestamp": _ts(),
            }
        )
        logger.info(
            "Skipped '%s' @ %s (score=%d < threshold=%d)",
            job.title, job.company, job_score.score, threshold,
        )
        return

    # Determine the right board to apply with
    board_name = job.source.lower()
    board = _get_board_for_source(board_name)

    applied = False
    if board is not None:
        try:
            applied = await board.apply(job, cv_path, profile_data)
        except CaptchaDetectedError as exc:
            _state["errors"].append(str(exc))
            await _broadcast(
                {
                    "type": "error",
                    "data": {"message": str(exc), "job_url": job.url},
                    "timestamp": _ts(),
                }
            )
            _state["status"] = "stopping"
            return
        except Exception as exc:
            logger.error("Apply failed for %s: %s", job.url, exc)
            _state["errors"].append(str(exc))
            await _broadcast(
                {
                    "type": "error",
                    "data": {"message": str(exc), "job_url": job.url},
                    "timestamp": _ts(),
                }
            )
    else:
        logger.warning("No board available to apply via source='%s'", board_name)

    if applied:
        _state["jobs_applied"] += 1

        # Persist to DB
        await _persist_application(job, profile, job_score.score, db)

        await _broadcast(
            {
                "type": "applied",
                "data": {
                    "title": job.title,
                    "company": job.company,
                    "url": job.url,
                    "score": job_score.score,
                },
                "timestamp": _ts(),
            }
        )
        logger.info(
            "Applied to '%s' @ %s (score=%d) — total=%d",
            job.title, job.company, job_score.score, _state["jobs_applied"],
        )
    else:
        await _broadcast(
            {
                "type": "skipped",
                "data": {
                    "title": job.title,
                    "company": job.company,
                    "score": job_score.score,
                    "reason": "apply returned False (no compatible form)",
                },
                "timestamp": _ts(),
            }
        )


async def _persist_application(
    job: JobListing,
    profile: Profile,
    score: int,
    db: AsyncSession,
) -> None:
    """Write or update the Job row to record a successful application."""
    result = await db.execute(
        select(Job).where(Job.profile_id == profile.id, Job.url == job.url)
    )
    job_row = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if job_row is None:
        job_row = Job(
            profile_id=profile.id,
            url=job.url,
            title=job.title,
            company=job.company,
            score=score,
            status="applied",
            applied_at=now,
        )
        db.add(job_row)
    else:
        job_row.status = "applied"
        job_row.applied_at = now
        job_row.score = score

    await db.commit()


# Module-level plugin registry so we can resolve source → board in
# _process_job without re-instantiating on every call.
_plugin_registry: dict[str, BaseJobBoard] = {}


def _get_board_for_source(source: str) -> BaseJobBoard | None:
    """Return the cached plugin instance matching *source*, or None."""
    return _plugin_registry.get(source)


def _register_plugins(plugins: list[BaseJobBoard]) -> None:
    """Populate the module-level plugin registry."""
    for plugin in plugins:
        name = type(plugin).__name__.lower().replace("board", "")
        _plugin_registry[name] = plugin
