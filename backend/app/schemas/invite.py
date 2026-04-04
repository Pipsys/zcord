from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.schemas.base import StrictSchema


class ServerInviteCreate(StrictSchema):
    expires_in_hours: int = Field(default=24, ge=1, le=168)
    max_uses: int | None = Field(default=10, ge=1, le=1000)


class ServerInviteRead(StrictSchema):
    code: str
    server_id: UUID
    invite_url: str
    expires_at: datetime | None
    max_uses: int | None
    uses_count: int
    created_at: datetime
