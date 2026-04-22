import hashlib
import shutil
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.db import CVCache, Profile
from app.models.profile import CVInfo, JobPreferences, ProfileCreate, ProfileResponse

router = APIRouter(tags=["profiles"])

CV_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
PROFILES_DIR = Path("data/profiles")


def _profile_dir(name: str) -> Path:
    return PROFILES_DIR / name


def _cv_path(name: str) -> Path:
    return _profile_dir(name) / "cv.pdf"


async def _get_profile_by_name(name: str, db: AsyncSession) -> Profile:
    result = await db.execute(select(Profile).where(Profile.name == name))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Profile '{name}' not found")
    return profile


@router.get("", response_model=list[ProfileResponse])
async def list_profiles(db: AsyncSession = Depends(get_db)) -> list[ProfileResponse]:
    result = await db.execute(select(Profile).order_by(Profile.created_at))
    profiles = result.scalars().all()
    return [ProfileResponse.model_validate(p) for p in profiles]


@router.post("", response_model=ProfileResponse, status_code=status.HTTP_201_CREATED)
async def create_profile(
    payload: ProfileCreate,
    db: AsyncSession = Depends(get_db),
) -> ProfileResponse:
    # Check uniqueness
    existing = await db.execute(select(Profile).where(Profile.name == payload.name))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A profile named '{payload.name}' already exists",
        )

    profile = Profile(
        name=payload.name,
        preferences=payload.preferences.model_dump(),
        is_active=False,
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)

    # Create the profile directory for future CV uploads
    _profile_dir(payload.name).mkdir(parents=True, exist_ok=True)

    return ProfileResponse.model_validate(profile)


@router.get("/{name}", response_model=ProfileResponse)
async def get_profile(name: str, db: AsyncSession = Depends(get_db)) -> ProfileResponse:
    profile = await _get_profile_by_name(name, db)
    return ProfileResponse.model_validate(profile)


@router.delete("/{name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(name: str, db: AsyncSession = Depends(get_db)) -> None:
    profile = await _get_profile_by_name(name, db)

    await db.delete(profile)
    await db.commit()

    # Remove profile directory and all its files
    profile_dir = _profile_dir(name)
    if profile_dir.exists():
        shutil.rmtree(profile_dir)


@router.put("/{name}/activate", response_model=ProfileResponse)
async def activate_profile(name: str, db: AsyncSession = Depends(get_db)) -> ProfileResponse:
    profile = await _get_profile_by_name(name, db)

    # Deactivate all profiles first
    await db.execute(update(Profile).values(is_active=False))

    # Activate the target profile
    profile.is_active = True
    await db.commit()
    await db.refresh(profile)

    return ProfileResponse.model_validate(profile)


@router.post("/{name}/cv", response_model=CVInfo, status_code=status.HTTP_201_CREATED)
async def upload_cv(
    name: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> CVInfo:
    profile = await _get_profile_by_name(name, db)

    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only PDF files are accepted",
        )

    # Read file into memory to check size before writing
    contents = await file.read()
    if len(contents) > CV_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="CV file must be ≤ 10 MB",
        )

    # Ensure the profile directory exists
    profile_dir = _profile_dir(name)
    profile_dir.mkdir(parents=True, exist_ok=True)

    cv_path = _cv_path(name)
    async with aiofiles.open(cv_path, "wb") as f:
        await f.write(contents)

    # Compute hash and store/update cv_cache entry (unparsed for now)
    pdf_hash = hashlib.sha256(contents).hexdigest()

    existing_cache = await db.execute(
        select(CVCache).where(CVCache.profile_id == profile.id)
    )
    cache_row = existing_cache.scalar_one_or_none()

    if cache_row is None:
        from datetime import datetime, timezone

        cache_row = CVCache(
            profile_id=profile.id,
            pdf_hash=pdf_hash,
            parsed_json={},
            parsed_at=datetime.now(timezone.utc),
        )
        db.add(cache_row)
    else:
        from datetime import datetime, timezone

        cache_row.pdf_hash = pdf_hash
        cache_row.parsed_json = {}
        cache_row.parsed_at = datetime.now(timezone.utc)

    await db.commit()

    filename = file.filename or "cv.pdf"
    return CVInfo(
        profile_name=name,
        filename=filename,
        size_bytes=len(contents),
        parsed=False,
        skills=[],
    )


@router.get("/{name}/cv", response_model=CVInfo)
async def get_cv_info(name: str, db: AsyncSession = Depends(get_db)) -> CVInfo:
    profile = await _get_profile_by_name(name, db)

    cv_path = _cv_path(name)
    if not cv_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No CV uploaded for profile '{name}'",
        )

    size_bytes = cv_path.stat().st_size

    # Check if parsing results exist in cv_cache
    cache_result = await db.execute(
        select(CVCache).where(CVCache.profile_id == profile.id)
    )
    cache_row = cache_result.scalar_one_or_none()

    parsed = False
    skills: list[str] = []

    if cache_row is not None and cache_row.parsed_json:
        parsed = bool(cache_row.parsed_json.get("parsed", False))
        skills = cache_row.parsed_json.get("skills", [])

    return CVInfo(
        profile_name=name,
        filename="cv.pdf",
        size_bytes=size_bytes,
        parsed=parsed,
        skills=skills,
    )
