from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.models.channel import ChannelType
from app.schemas.base import StrictSchema


class ChannelCreate(StrictSchema):
    server_id: UUID | None = Field(default=None, strict=False)
    type: ChannelType = Field(default=ChannelType.text, strict=False)
    name: str = Field(min_length=1, max_length=100)
    topic: str | None = Field(default=None, max_length=1024)
    position: int = 0
    is_nsfw: bool = False
    slowmode_delay: int = 0
    parent_id: UUID | None = Field(default=None, strict=False)


class ChannelUpdate(StrictSchema):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    topic: str | None = Field(default=None, max_length=1024)
    position: int | None = None
    is_nsfw: bool | None = None
    slowmode_delay: int | None = None
    parent_id: UUID | None = Field(default=None, strict=False)


class ChannelRead(StrictSchema):
    id: UUID
    server_id: UUID | None
    type: ChannelType
    name: str
    topic: str | None
    position: int
    is_nsfw: bool
    slowmode_delay: int
    parent_id: UUID | None
    created_at: datetime
