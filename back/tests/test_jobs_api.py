"""Tests for profile-isolated GET /jobs history endpoint and payload contracts."""

import json
from datetime import UTC, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Job
from tests.conftest import create_job_row, create_profile_row


async def test_get_jobs_unknown_profile_returns_404(client: httpx.AsyncClient) -> None:
    response = await client.get("/jobs", params={"profile": "does-not-exist"})
    assert response.status_code == 404
    assert response.json()["detail"] == "Profile 'does-not-exist' not found"


async def test_get_jobs_requires_profile_query_param(client: httpx.AsyncClient) -> None:
    response = await client.get("/jobs")
    assert response.status_code == 422


async def test_get_jobs_empty_history_returns_200_list(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    await create_profile_row(db_session, "empty-user")

    response = await client.get("/jobs", params={"profile": "empty-user"})
    assert response.status_code == 200
    assert response.json() == []


async def test_get_jobs_enforces_profile_isolation_and_payload_contract(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    alice = await create_profile_row(db_session, "alice", is_active=True)
    bob = await create_profile_row(db_session, "bob")

    applied_time = datetime(2026, 11, 20, 15, 30, tzinfo=UTC)
    first_job = await create_job_row(
        db_session,
        alice.id,
        title="Backend Engineer",
        company="Acme Corp",
        url="https://example.com/jobs/1",
        score=None,
        status="pending",
    )
    second_job = await create_job_row(
        db_session,
        alice.id,
        title="Senior Python Dev",
        company="Beta Labs",
        url="https://example.com/jobs/2",
        score=88,
        status="applied",
        applied_at=applied_time,
    )
    await create_job_row(
        db_session,
        bob.id,
        title="Private Bob Role",
        company="Secret Co",
        url="https://example.com/jobs/bob",
        score=95,
        status="applied",
        applied_at=applied_time,
    )

    # First read
    response = await client.get("/jobs", params={"profile": "alice"})
    assert response.status_code == 200
    payload = response.json()

    assert len(payload) == 2
    assert [item["id"] for item in payload] == [second_job.id, first_job.id]

    newest, oldest = payload
    assert isinstance(newest["id"], int)
    assert newest["profile_id"] == alice.id
    assert newest["title"] == "Senior Python Dev"
    assert newest["company"] == "Beta Labs"
    assert newest["score"] == 88
    assert newest["status"] == "applied"
    assert newest["reason"] is None
    assert newest["applied_at"] is not None
    assert datetime.fromisoformat(newest["applied_at"])
    assert datetime.fromisoformat(newest["created_at"])

    # Nullable score must serialize as JSON null, never 0
    assert oldest["score"] is None
    assert oldest["status"] == "pending"
    assert oldest["applied_at"] is None

    # Reload durability: a subsequent request still returns the exact seeded history
    reload_response = await client.get("/jobs", params={"profile": "alice"})
    assert reload_response.status_code == 200
    assert reload_response.json() == payload


async def test_get_jobs_normalizes_legacy_json_and_unknown_statuses_without_mutating_db(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    alice = await create_profile_row(db_session, "legacy-user")

    legacy_json = json.dumps(
        {
            "score": 82,
            "reasons": ["Strong Python match"],
            "concerns": ["Needs AWS cert"],
            "recommendation": "apply",
        }
    )
    legacy_row = await create_job_row(
        db_session,
        alice.id,
        title="Legacy Scored Role",
        company="OldCo",
        url="https://example.com/jobs/legacy-json",
        score=82,
        status=legacy_json,
    )
    unknown_row = await create_job_row(
        db_session,
        alice.id,
        title="Unknown Status Role",
        company="MysteryCo",
        url="https://example.com/jobs/legacy-unknown",
        score=None,
        status="weird_old_state",
    )

    response = await client.get("/jobs", params={"profile": "legacy-user"})
    assert response.status_code == 200
    by_id = {item["id"]: item for item in response.json()}

    # Legacy JSON score rows must never be reported as applied
    assert by_id[legacy_row.id]["status"] == "pending"
    assert by_id[legacy_row.id]["score"] == 82
    assert "Strong Python match" in (by_id[legacy_row.id]["reason"] or "")
    assert "Needs AWS cert" in (by_id[legacy_row.id]["reason"] or "")

    # Unknown legacy status strings stay visible and safe
    assert by_id[unknown_row.id]["status"] == "pending"
    assert by_id[unknown_row.id]["score"] is None
    assert by_id[unknown_row.id]["reason"] == "Legacy status: weird_old_state"

    # Original DB rows are preserved untouched
    refreshed = await db_session.execute(select(Job).where(Job.id == legacy_row.id))
    assert refreshed.scalar_one().status == legacy_json
