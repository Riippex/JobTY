"""Isolated test fixtures for JobTY backend tests.

Every test uses a temporary SQLite database and temporary profile/config
directories under pytest's tmp_path so local user data in back/data/ is never
read or modified. No real LLM providers, browsers, or credentials are used.
"""

from collections.abc import AsyncGenerator
from datetime import datetime
from pathlib import Path

import httpx
import pytest
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app import database
from app import main as app_main
from app.models.db import Base, Job, Profile
from app.plugins.base_board import BaseJobBoard, JobListing
from app.routers import profiles as profiles_router
from app.services import agent_runner, config_store, cv_parser, llm_provider


class FakeLLMProvider:
    """Deterministic fake LLM provider returning preconfigured structured objects."""

    def __init__(self, responses: dict[type[BaseModel], BaseModel] | None = None) -> None:
        self._responses = responses or {}
        self.calls: list[tuple[str, type[BaseModel]]] = []

    async def complete_structured(
        self,
        prompt: str,
        schema: type[BaseModel],
        system: str = "",
    ) -> BaseModel:
        self.calls.append((prompt, schema))
        if schema in self._responses:
            return self._responses[schema]
        raise AssertionError(f"Unexpected schema requested from FakeLLMProvider: {schema}")


class FakeJobBoard(BaseJobBoard):
    """In-memory job board plugin for behavior tests — never opens a browser."""

    def __init__(
        self,
        listings: list[JobListing],
        *,
        apply_result: bool = True,
        on_apply=None,
    ) -> None:
        self._listings = listings
        self._apply_result = apply_result
        self._on_apply = on_apply
        self.applied_urls: list[str] = []

    async def search(
        self,
        keywords: list[str],
        locations: list[str],
        remote_only: bool,
    ) -> list[JobListing]:
        return list(self._listings)

    async def apply(self, job: JobListing, cv_path: str, profile_data: dict) -> bool:
        if self._on_apply is not None:
            await self._on_apply(job)
        self.applied_urls.append(job.url)
        return self._apply_result

    async def is_available(self) -> bool:
        return True


def _reset_runtime_singletons() -> None:
    agent_runner._state.update(
        {
            "status": "idle",
            "current_job": None,
            "jobs_applied": 0,
            "errors": [],
            "started_at": None,
            "stopped_at": None,
            "profile": None,
        }
    )
    agent_runner._plugin_registry.clear()
    llm_provider.reset_provider()
    app_main._ws_clients.clear()


@pytest.fixture
async def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> AsyncGenerator[dict, None]:
    """Provide an isolated temp SQLite DB and patched paths for each test."""
    db_path = tmp_path / "test_jobty.db"
    db_url = f"sqlite+aiosqlite:///{db_path.as_posix()}"

    test_engine = create_async_engine(
        db_url,
        connect_args={"check_same_thread": False},
        echo=False,
    )
    test_session_factory = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
        autocommit=False,
    )

    profiles_dir = tmp_path / "profiles"
    profiles_dir.mkdir(parents=True, exist_ok=True)
    config_path = tmp_path / "config.json"

    monkeypatch.setattr(database, "DATABASE_URL", db_url)
    monkeypatch.setattr(database, "engine", test_engine)
    monkeypatch.setattr(database, "AsyncSessionLocal", test_session_factory)
    monkeypatch.setattr(agent_runner, "AsyncSessionLocal", test_session_factory)
    monkeypatch.setattr(profiles_router, "PROFILES_DIR", profiles_dir)
    monkeypatch.setattr(cv_parser, "PROFILES_DIR", profiles_dir)
    monkeypatch.setattr(config_store, "CONFIG_PATH", config_path)

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def _override_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with test_session_factory() as session:
            yield session

    app_main.app.dependency_overrides[database.get_db] = _override_get_db
    _reset_runtime_singletons()

    try:
        yield {
            "engine": test_engine,
            "session_factory": test_session_factory,
            "profiles_dir": profiles_dir,
            "config_path": config_path,
        }
    finally:
        app_main.app.dependency_overrides.clear()
        _reset_runtime_singletons()
        await test_engine.dispose()


@pytest.fixture
async def db_session(isolated_env: dict) -> AsyncGenerator[AsyncSession, None]:
    async with isolated_env["session_factory"]() as session:
        yield session


@pytest.fixture
async def client(isolated_env: dict) -> AsyncGenerator[httpx.AsyncClient, None]:
    transport = httpx.ASGITransport(app=app_main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac


async def create_profile_row(
    session: AsyncSession,
    name: str,
    *,
    is_active: bool = False,
    preferences: dict | None = None,
) -> Profile:
    profile = Profile(
        name=name,
        preferences=preferences
        or {
            "keywords": ["python"],
            "locations": ["Remote"],
            "remote_only": True,
            "min_salary": None,
            "max_applications_per_run": 5,
            "job_types": ["full-time"],
        },
        is_active=is_active,
    )
    session.add(profile)
    await session.commit()
    await session.refresh(profile)
    return profile


async def create_job_row(
    session: AsyncSession,
    profile_id: int,
    *,
    title: str,
    company: str,
    url: str,
    score: int | None = None,
    status: str = "pending",
    applied_at: datetime | None = None,
) -> Job:
    job = Job(
        profile_id=profile_id,
        title=title,
        company=company,
        url=url,
        score=score,
        status=status,
        applied_at=applied_at,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job
