from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class JobCreate(BaseModel):
    url: str
    company: str
    title: str
    score: int | None = None
    status: str = "pending"


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    url: str
    company: str
    title: str
    score: int | None
    status: str
    applied_at: datetime | None
    created_at: datetime


class JobUpdate(BaseModel):
    score: int | None = None
    status: str | None = None
    applied_at: datetime | None = None
