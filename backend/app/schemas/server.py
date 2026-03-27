from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import StrictSchema


class ServerCreate(StrictSchema):
    name: str = Field(min_length=2, max_length=100)
    icon_url: str | None = None
    banner_url: str | None = None
    region: str | None = Field(default=None, max_length=64)
    is_nsfw: bool = False


class ServerUpdate(StrictSchema):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    icon_url: str | None = None
    banner_url: str | None = None
    region: str | None = Field(default=None, max_length=64)
    is_nsfw: bool | None = None


class ServerRead(StrictSchema):
    id: UUID
    name: str
    icon_url: str | None
    banner_url: str | None
    owner_id: UUID
    region: str | None
    is_nsfw: bool
    max_members: int
    created_at: datetime
