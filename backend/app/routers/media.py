from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from minio.error import S3Error
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from app.config import get_settings
from app.database import get_session
from app.models.attachment import Attachment
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.media import UploadResponse
from app.services.media_service import MediaService

router = APIRouter(prefix="/media", tags=["media"])
settings = get_settings()


def _close_object_stream(response: object) -> None:
    close = getattr(response, "close", None)
    if callable(close):
        close()
    release_conn = getattr(response, "release_conn", None)
    if callable(release_conn):
        release_conn()


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    message_id: UUID,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    media_service = MediaService(session)
    attachment = await media_service.upload(message_id=message_id, uploader_id=current_user.id, upload_file=file)
    return UploadResponse(
        attachment_id=attachment.id,
        object_key=attachment.minio_key,
        download_url=media_service.presigned_download_url(attachment.minio_key),
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
    )


@router.get("/{attachment_id}", response_model=UploadResponse)
async def get_attachment(
    attachment_id: UUID,
    session: AsyncSession = Depends(get_session),
    _: User = Depends(get_current_user),
):
    attachment = await session.get(Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    media_service = MediaService(session)
    return UploadResponse(
        attachment_id=attachment.id,
        object_key=attachment.minio_key,
        download_url=media_service.presigned_download_url(attachment.minio_key),
        content_type=attachment.content_type,
        size_bytes=attachment.size_bytes,
    )


@router.get("/public/{object_key:path}", include_in_schema=False)
async def get_public_media_asset(
    object_key: str,
    session: AsyncSession = Depends(get_session),
):
    media_service = MediaService(session)
    normalized_key = object_key.lstrip("/")
    if not media_service.is_public_media_key(normalized_key):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    try:
        object_response = media_service.client.get_object(settings.minio_bucket, normalized_key)
    except S3Error as exc:
        if exc.code in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found") from exc
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Storage temporarily unavailable") from exc

    response_headers = getattr(object_response, "headers", {}) or {}
    content_type = response_headers.get("content-type", "application/octet-stream")
    content_length = response_headers.get("content-length")
    etag = response_headers.get("etag")
    last_modified = response_headers.get("last-modified")

    headers: dict[str, str] = {
        "Cache-Control": "public, max-age=31536000, immutable",
    }
    if isinstance(content_length, str) and content_length:
        headers["Content-Length"] = content_length
    if isinstance(etag, str) and etag:
        headers["ETag"] = etag
    if isinstance(last_modified, str) and last_modified:
        headers["Last-Modified"] = last_modified

    return StreamingResponse(
        object_response.stream(32 * 1024),
        media_type=content_type,
        headers=headers,
        background=BackgroundTask(_close_object_stream, object_response),
    )
