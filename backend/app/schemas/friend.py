from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.models.friend import FriendStatus
from app.schemas.base import StrictSchema


class FriendRequestCreate(StrictSchema):
    addressee_id: UUID = Field(strict=False)


class FriendRequestUpdate(StrictSchema):
    status: FriendStatus = Field(strict=False)


class FriendRead(StrictSchema):
    requester_id: UUID
    addressee_id: UUID
    requester_username: str | None = None
    addressee_username: str | None = None
    requester_avatar_url: str | None = None
    addressee_avatar_url: str | None = None
    status: FriendStatus
    created_at: datetime
