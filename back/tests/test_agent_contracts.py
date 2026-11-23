"""Tests for agent status contract, fake-board runner flow, and WebSocket events."""

from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app import main as app_main
from app.models.db import CVCache
from app.plugins.base_board import JobListing
from app.services import agent_runner, job_scorer
from app.services.job_scorer import JobScore
from tests.conftest import FakeJobBoard, FakeLLMProvider, create_profile_row


async def test_agent_status_idle_contract(client: httpx.AsyncClient) -> None:
    response = await client.get("/agent/status")
    assert response.status_code == 200
    assert response.json() == {
        "status": "idle",
        "current_job": None,
        "jobs_applied": 0,
        "errors": [],
        "started_at": None,
        "stopped_at": None,
        "profile": None,
    }


async def test_agent_start_and_stop_error_codes(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    # Unknown profile -> 404
    missing = await client.post("/agent/start", json={"profile_name": "nobody"})
    assert missing.status_code == 404

    # Stop while idle -> 409
    stop_idle = await client.post("/agent/stop")
    assert stop_idle.status_code == 409

    # Already running -> 409
    await create_profile_row(db_session, "alice")
    agent_runner._state["status"] = "running"
    already_running = await client.post("/agent/start", json={"profile_name": "alice"})
    assert already_running.status_code == 409


async def test_runner_emits_profiled_iso_events_structured_current_job_and_persists_history(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    alice = await create_profile_row(db_session, "alice", is_active=True)
    db_session.add(
        CVCache(
            profile_id=alice.id,
            pdf_hash="fake-hash",
            parsed_json={
                "parsed": True,
                "skills": ["Python", "FastAPI"],
                "languages": ["English"],
                "experience_years": 5,
                "education": ["BSc CS"],
                "summary": "Backend engineer",
            },
            parsed_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    fake_llm = FakeLLMProvider(
        {
            JobScore: JobScore(
                score=86,
                reasons=["Python + FastAPI match"],
                concerns=[],
                recommendation="apply",
            )
        }
    )
    monkeypatch.setattr(job_scorer, "get_llm_provider", lambda: fake_llm)

    status_during_apply: dict = {}

    async def _capture_status(_job: JobListing) -> None:
        resp = await client.get("/agent/status")
        assert resp.status_code == 200
        status_during_apply.update(resp.json())

    listing = JobListing(
        url="https://fake-board.local/jobs/42",
        title="FastAPI Engineer",
        company="TestWorks",
        location="Remote",
        description="Build FastAPI services.",
        source="fakejob",
    )
    fake_board = FakeJobBoard([listing], apply_result=True, on_apply=_capture_status)
    monkeypatch.setattr(agent_runner, "_build_plugins", lambda: [fake_board])

    captured_events: list[dict] = []

    async def _capture_broadcast(event: dict) -> None:
        captured_events.append(event)

    monkeypatch.setattr(app_main, "broadcast", _capture_broadcast)

    await agent_runner.start_agent("alice")

    # Structured current_job contract observed while processing
    assert status_during_apply["status"] == "running"
    assert status_during_apply["profile"] == "alice"
    assert status_during_apply["current_job"] == {
        "title": "FastAPI Engineer",
        "company": "TestWorks",
        "url": "https://fake-board.local/jobs/42",
        "source": "fakejob",
    }

    # Final status transitions cleanly to stopped and clears current_job
    final_status = (await client.get("/agent/status")).json()
    assert final_status["status"] == "stopped"
    assert final_status["current_job"] is None
    assert final_status["jobs_applied"] == 1
    assert final_status["profile"] == "alice"
    assert final_status["started_at"] is not None
    assert final_status["stopped_at"] is not None

    # Every WebSocket event includes ISO timestamp and profile context
    event_types = [ev["type"] for ev in captured_events]
    assert event_types == [
        "status",
        "job_found",
        "job_scored",
        "applying",
        "applied",
        "status",
    ]
    for ev in captured_events:
        assert ev["profile"] == "alice"
        assert ev["data"]["profile"] == "alice"
        assert isinstance(ev["timestamp"], str)
        assert datetime.fromisoformat(ev["timestamp"])

    assert captured_events[0]["data"]["status"] == "running"
    assert captured_events[-1]["data"]["status"] == "stopped"
    assert fake_board.applied_urls == ["https://fake-board.local/jobs/42"]

    # Applied job is persisted and returned via GET /jobs
    jobs_response = await client.get("/jobs", params={"profile": "alice"})
    assert jobs_response.status_code == 200
    jobs = jobs_response.json()
    assert len(jobs) == 1
    assert jobs[0]["url"] == "https://fake-board.local/jobs/42"
    assert jobs[0]["status"] == "applied"
    assert jobs[0]["score"] == 86


def test_websocket_endpoint_broadcasts_json_envelope(isolated_env: dict) -> None:
    with TestClient(app_main.app) as sync_client:
        with sync_client.websocket_connect("/ws") as ws:
            event = agent_runner._build_event(
                "status",
                {"status": "running", "jobs_applied": 0},
                profile="alice",
            )
            sync_client.portal.call(app_main.broadcast, event)
            received = ws.receive_json()

            assert received["type"] == "status"
            assert received["profile"] == "alice"
            assert received["data"]["status"] == "running"
            assert received["data"]["profile"] == "alice"
            assert isinstance(received["timestamp"], str)
            assert datetime.fromisoformat(received["timestamp"])
