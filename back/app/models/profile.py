from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class JobPreferences(BaseModel):
    keywords: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    remote_only: bool = False
    min_salary: int | None = None
    max_applications_per_run: int = 10
    job_types: list[str] = Field(default_factory=list)


class ProfileCreate(BaseModel):
    name: str
    preferences: JobPreferences = Field(default_factory=JobPreferences)


class ProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_active: bool
    preferences: JobPreferences
    created_at: datetime


class ProfileUpdate(BaseModel):
    preferences: JobPreferences | None = None


class CVInfo(BaseModel):
    profile_name: str
    filename: str
    size_bytes: int
    parsed: bool
    skills: list[str] = Field(default_factory=list)
