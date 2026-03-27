from __future__ import annotations

from uuid import UUID

from app.schemas.base import StrictSchema


class UploadResponse(StrictSchema):
    attachment_id: UUID
    object_key: str
    download_url: str
    content_type: str
    size_bytes: int
