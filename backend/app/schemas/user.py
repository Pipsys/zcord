from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import EmailStr, Field

from app.models.user import UserStatus
from app.schemas.base import StrictSchema


class UserRead(StrictSchema):
    id: UUID
    username: str
    discriminator: str
    email: EmailStr
    avatar_url: str | None
    banner_url: str | None
    bio: str | None
    status: UserStatus
    custom_status: str | None
    public_key: str | None
    is_bot: bool
    is_verified: bool
    created_at: datetime


class UserUpdate(StrictSchema):
    username: str | None = Field(default=None, min_length=2, max_length=32)
    email: EmailStr | None = None
    current_password: str | None = Field(default=None, min_length=8, max_length=128)
    new_password: str | None = Field(default=None, min_length=8, max_length=128)
    avatar_url: str | None = None
    banner_url: str | None = None
    bio: str | None = Field(default=None, max_length=190)
    status: UserStatus | None = Field(default=None, strict=False)
    custom_status: str | None = Field(default=None, max_length=128)
