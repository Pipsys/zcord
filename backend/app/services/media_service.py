from __future__ import annotations

import io
import uuid
from datetime import timedelta
from urllib.parse import quote, urlsplit

import magic
from fastapi import HTTPException, UploadFile, status
from minio import Minio
from minio.error import S3Error
from PIL import Image, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.attachment import Attachment
from app.models.message import Message

settings = get_settings()
AVATAR_MAX_BYTES = 25 * 1024 * 1024
PUBLIC_MEDIA_PREFIXES = ("avatars/", "server-icons/", "server-banners/")
ALLOWED_AVATAR_MIME_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
}
ALLOWED_SERVER_ICON_MIME_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
}
SERVER_ICON_MAX_BYTES = 25 * 1024 * 1024
SERVER_BANNER_MAX_BYTES = 30 * 1024 * 1024
ALLOWED_SERVER_BANNER_MIME_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
}

def _is_supported_mime_type(value: str) -> bool:
    if not value:
        return False
    if "/" not in value:
        return False
    main_type, sub_type = value.split("/", 1)
    if not main_type or not sub_type:
        return False
    return True


def _resolve_endpoint(endpoint: str | None, fallback: str, fallback_secure: bool) -> tuple[str, bool]:
    raw = endpoint.strip() if isinstance(endpoint, str) else ""
    if not raw:
        return fallback, fallback_secure

    if "://" in raw:
        parsed = urlsplit(raw)
        if parsed.netloc:
            return parsed.netloc, parsed.scheme.lower() == "https"
        return fallback, fallback_secure

    return raw, fallback_secure


class MediaService:
    def __init__(self, session: AsyncSession):
        self.session = session
        private_endpoint, private_secure = _resolve_endpoint(settings.minio_endpoint, settings.minio_endpoint, settings.minio_secure)
        public_endpoint, public_secure = _resolve_endpoint(settings.minio_public_endpoint, private_endpoint, private_secure)

        self.client = Minio(
            endpoint=private_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=private_secure,
            region=settings.minio_region,
        )
        self.public_client = Minio(
            endpoint=public_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=public_secure,
            region=settings.minio_region,
        )
        self.public_api_base_url = self._resolve_public_api_base_url(public_endpoint, public_secure)

    def _resolve_public_api_base_url(self, fallback_endpoint: str, fallback_secure: bool) -> str:
        configured = settings.public_api_base_url.strip() if isinstance(settings.public_api_base_url, str) else ""
        if configured:
            return configured.rstrip("/")

        # Development default: backend usually runs on localhost:8000.
        if settings.env.lower() == "development":
            return "http://localhost:8000"

        raw_public_endpoint = settings.minio_public_endpoint.strip() if isinstance(settings.minio_public_endpoint, str) else ""
        if "://" in raw_public_endpoint:
            parsed = urlsplit(raw_public_endpoint)
            if parsed.scheme and parsed.netloc:
                return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")

        scheme = "https" if fallback_secure else "http"
        return f"{scheme}://{fallback_endpoint}".rstrip("/")

    def ensure_bucket(self) -> None:
        if not self.client.bucket_exists(settings.minio_bucket):
            self.client.make_bucket(settings.minio_bucket)

    async def upload(self, message_id: uuid.UUID, uploader_id: uuid.UUID, upload_file: UploadFile) -> Attachment:
        if upload_file.size and upload_file.size > settings.max_upload_bytes:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Upload exceeds 50MB")

        message = await self.session.get(Message, message_id)
        if message is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        if message.author_id != uploader_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only message author can upload attachments")

        payload = await upload_file.read()
        if len(payload) > settings.max_upload_bytes:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Upload exceeds 50MB")

        guessed = magic.from_buffer(payload[:2048], mime=True)
        content_type = guessed or upload_file.content_type or "application/octet-stream"
        if not _is_supported_mime_type(content_type):
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Unsupported file type")

        filename = (upload_file.filename or "file").replace("\\", "_").replace("/", "_")
        object_key = f"attachments/{message_id}/{uuid.uuid4()}-{filename}"
        self.ensure_bucket()

        try:
            self.client.put_object(
                settings.minio_bucket,
                object_key,
                io.BytesIO(payload),
                length=len(payload),
                content_type=content_type,
            )
        except S3Error as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Storage temporarily unavailable") from exc

        width = None
        height = None
        try:
            with Image.open(io.BytesIO(payload)) as image:
                width, height = image.size
        except UnidentifiedImageError:
            pass

        attachment = Attachment(
            message_id=message_id,
            filename=filename,
            content_type=content_type,
            size_bytes=len(payload),
            minio_key=object_key,
            width=width,
            height=height,
        )
        self.session.add(attachment)
        await self.session.commit()
        await self.session.refresh(attachment)
        return attachment

    async def upload_user_avatar(self, user_id: uuid.UUID, upload_file: UploadFile) -> str:
        if upload_file.size and upload_file.size > AVATAR_MAX_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Avatar exceeds 25MB")

        payload = await upload_file.read()
        if len(payload) > AVATAR_MAX_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Avatar exceeds 25MB")

        guessed = magic.from_buffer(payload[:2048], mime=True)
        content_type = guessed or upload_file.content_type or ""
        extension = ALLOWED_AVATAR_MIME_TYPES.get(content_type)
        if extension is None:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Unsupported avatar type. Allowed: PNG, JPG, GIF",
            )

        # Validate payload as an image before storing.
        try:
            with Image.open(io.BytesIO(payload)) as image:
                image.verify()
        except (UnidentifiedImageError, OSError) as exc:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Invalid image payload") from exc

        object_key = f"avatars/{user_id}/{uuid.uuid4()}.{extension}"
        self.ensure_bucket()
        try:
            self.client.put_object(
                settings.minio_bucket,
                object_key,
                io.BytesIO(payload),
                length=len(payload),
                content_type=content_type,
            )
        except S3Error as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Storage temporarily unavailable") from exc

        return object_key

    async def upload_server_icon(self, server_id: uuid.UUID, upload_file: UploadFile) -> str:
        if upload_file.size and upload_file.size > SERVER_ICON_MAX_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Server icon exceeds 25MB")

        payload = await upload_file.read()
        if len(payload) > SERVER_ICON_MAX_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Server icon exceeds 25MB")

        guessed = magic.from_buffer(payload[:2048], mime=True)
        content_type = guessed or upload_file.content_type or ""
        extension = ALLOWED_SERVER_ICON_MIME_TYPES.get(content_type)
        if extension is None:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Unsupported server icon type. Allowed: PNG, JPG, GIF",
            )

        try:
            with Image.open(io.BytesIO(payload)) as image:
                image.verify()
        except (UnidentifiedImageError, OSError) as exc:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Invalid image payload") from exc

        object_key = f"server-icons/{server_id}/{uuid.uuid4()}.{extension}"
        self.ensure_bucket()
        try:
            self.client.put_object(
                settings.minio_bucket,
                object_key,
                io.BytesIO(payload),
                length=len(payload),
                content_type=content_type,
            )
        except S3Error as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Storage temporarily unavailable") from exc

        return object_key

    async def upload_server_banner(self, server_id: uuid.UUID, upload_file: UploadFile) -> str:
        if upload_file.size and upload_file.size > SERVER_BANNER_MAX_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Server banner exceeds 30MB")

        payload = await upload_file.read()
        if len(payload) > SERVER_BANNER_MAX_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Server banner exceeds 30MB")

        guessed = magic.from_buffer(payload[:2048], mime=True)
        content_type = guessed or upload_file.content_type or ""
        extension = ALLOWED_SERVER_BANNER_MIME_TYPES.get(content_type)
        if extension is None:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Unsupported server banner type. Allowed: PNG, JPG, GIF",
            )

        try:
            with Image.open(io.BytesIO(payload)) as image:
                image.verify()
        except (UnidentifiedImageError, OSError) as exc:
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Invalid image payload") from exc

        object_key = f"server-banners/{server_id}/{uuid.uuid4()}.{extension}"
        self.ensure_bucket()
        try:
            self.client.put_object(
                settings.minio_bucket,
                object_key,
                io.BytesIO(payload),
                length=len(payload),
                content_type=content_type,
            )
        except S3Error as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Storage temporarily unavailable") from exc

        return object_key

    def resolve_public_url(self, stored_value: str | None) -> str | None:
        if not stored_value:
            return None
        if "://" in stored_value:
            return stored_value
        if self.is_public_media_key(stored_value):
            return self.public_media_url(stored_value)
        return self.presigned_download_url(stored_value)

    def is_public_media_key(self, object_key: str) -> bool:
        return isinstance(object_key, str) and object_key.startswith(PUBLIC_MEDIA_PREFIXES)

    def public_media_url(self, object_key: str) -> str:
        encoded = quote(object_key, safe="/")
        return f"{self.public_api_base_url}{settings.api_prefix}/media/public/{encoded}"

    def delete_object(self, object_key: str) -> None:
        if not object_key or "://" in object_key:
            return
        try:
            self.client.remove_object(settings.minio_bucket, object_key)
        except S3Error:
            return

    def presigned_download_url(self, object_key: str, *, expires_seconds: int | None = None) -> str:
        self.ensure_bucket()
        ttl = expires_seconds if isinstance(expires_seconds, int) and expires_seconds > 0 else settings.upload_url_ttl_seconds
        return self.public_client.presigned_get_object(
            settings.minio_bucket,
            object_key,
            expires=timedelta(seconds=ttl),
        )
