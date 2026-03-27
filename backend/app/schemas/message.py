from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import Field

from app.models.message import MessageType
from app.schemas.base import StrictSchema


class ReactionPayload(StrictSchema):
    emoji: str = Field(min_length=1, max_length=64)


class MessageCreate(StrictSchema):
    channel_id: UUID = Field(strict=False)
    content: str = Field(min_length=0, max_length=4000)
    nonce: str | None = None
    type: MessageType = Field(default=MessageType.default, strict=False)
    reference_id: UUID | None = Field(default=None, strict=False)


class MessageUpdate(StrictSchema):
    content: str = Field(min_length=1, max_length=4000)


class MessageAttachmentRead(StrictSchema):
    id: UUID
    filename: str
    content_type: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    download_url: str


class MessageRead(StrictSchema):
    id: UUID
    channel_id: UUID
    server_id: UUID | None = None
    author_id: UUID
    author_username: str | None = None
    author_avatar_url: str | None = None
    content: str
    nonce: str | None
    type: MessageType
    reference_id: UUID | None
    edited_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime
    delivered_at: datetime | None = None
    read_at: datetime | None = None
    delivered_by: list[UUID] = Field(default_factory=list)
    read_by: list[UUID] = Field(default_factory=list)
    attachments: list[MessageAttachmentRead] = Field(default_factory=list)


class MessageDeleteRead(StrictSchema):
    message_id: UUID
    channel_id: UUID
    server_id: UUID | None = None
    deleted_at: datetime
