from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.attachment import Attachment
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.media import UploadResponse
from app.services.media_service import MediaService

router = APIRouter(prefix="/media", tags=["media"])


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
