"""CV parsing router.

POST /cv/{profile_name}/parse   — trigger LLM parsing and return CVParsed
GET  /cv/{profile_name}/parsed  — return cached CVParsed (404 if not yet parsed)
PUT  /cv/{profile_name}/parsed  — manually override cached CVParsed
"""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db import CVCache, Profile
from app.services.cv_parser import CVParsed, parse_cv
from app.services.llm_provider import LLMParseError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["cv"])


class CVParsedUpdate(BaseModel):
    skills: list[str]
    languages: list[str]
    experience_years: int
    education: list[str]
    summary: str


@router.post("/{profile_name}/parse", response_model=CVParsed)
async def trigger_parse(
    profile_name: str,
    db: AsyncSession = Depends(get_db),
) -> CVParsed:
    """Parse the uploaded CV for *profile_name* and return structured data.

    - 404 if the profile does not exist.
    - 404 if no CV has been uploaded yet.
    - 422 if the LLM fails to return valid JSON after retries.
    """
    try:
        return await parse_cv(profile_name, db)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except LLMParseError as exc:
        logger.error("LLM parse error for profile '%s': %s", profile_name, exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"LLM returned unparseable response: {exc}",
        )
    except Exception as exc:
        logger.error("Unexpected error parsing CV for '%s': %s", profile_name, exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"CV parse failed: {exc}",
        )


@router.get("/{profile_name}/parsed", response_model=CVParsed)
async def get_parsed(
    profile_name: str,
    db: AsyncSession = Depends(get_db),
) -> CVParsed:
    """Return the cached parsed CV for *profile_name*.

    - 404 if the profile does not exist or no parsed CV is cached.
    """
    profile_result = await db.execute(
        select(Profile).where(Profile.name == profile_name)
    )
    profile = profile_result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile '{profile_name}' not found",
        )

    cache_result = await db.execute(
        select(CVCache).where(CVCache.profile_id == profile.id)
    )
    cache_row = cache_result.scalar_one_or_none()

    if cache_row is None or not cache_row.parsed_json.get("parsed"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No parsed CV found for profile '{profile_name}'. Call POST /cv/{profile_name}/parse first.",
        )

    return CVParsed.model_validate(cache_row.parsed_json)


@router.put("/{profile_name}/parsed", response_model=CVParsed)
async def update_parsed(
    profile_name: str,
    payload: CVParsedUpdate,
    db: AsyncSession = Depends(get_db),
) -> CVParsed:
    """Manually override the parsed CV data for a profile."""
    profile_result = await db.execute(
        select(Profile).where(Profile.name == profile_name)
    )
    profile = profile_result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile '{profile_name}' not found",
        )

    cache_result = await db.execute(
        select(CVCache).where(CVCache.profile_id == profile.id)
    )
    cache_row = cache_result.scalar_one_or_none()

    new_data = payload.model_dump()
    new_data["parsed"] = True

    if cache_row is None:
        cache_row = CVCache(
            profile_id=profile.id,
            pdf_hash="manual",
            parsed_json=new_data,
            parsed_at=datetime.now(UTC),
        )
        db.add(cache_row)
    else:
        cache_row.parsed_json = new_data

    await db.commit()
    return CVParsed.model_validate(payload.model_dump())
