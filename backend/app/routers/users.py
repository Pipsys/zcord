from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.user import UserRead, UserUpdate
from app.services.media_service import MediaService

router = APIRouter(prefix="/users", tags=["users"])


def _serialize_user(user: User, media_service: MediaService) -> UserRead:
    return UserRead.model_validate(
        {
            "id": user.id,
            "username": user.username,
            "discriminator": user.discriminator,
            "email": user.email,
            "avatar_url": media_service.resolve_public_url(user.avatar_url),
            "banner_url": media_service.resolve_public_url(user.banner_url),
            "bio": user.bio,
            "status": user.status,
            "custom_status": user.custom_status,
            "public_key": user.public_key,
            "is_bot": user.is_bot,
            "is_verified": user.is_verified,
            "created_at": user.created_at,
        }
    )


@router.get("/me", response_model=UserRead)
async def get_me(session: AsyncSession = Depends(get_session), current_user: User = Depends(get_current_user)):
    media_service = MediaService(session)
    return _serialize_user(current_user, media_service)


@router.patch("/me", response_model=UserRead)
async def update_me(
    payload: UserUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    media_service = MediaService(session)
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(current_user, key, value)
    await session.commit()
    await session.refresh(current_user)
    return _serialize_user(current_user, media_service)


@router.post("/me/avatar", response_model=UserRead)
async def upload_my_avatar(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    media_service = MediaService(session)
    old_avatar_key = current_user.avatar_url
    object_key = await media_service.upload_user_avatar(current_user.id, file)
    current_user.avatar_url = object_key
    await session.commit()
    await session.refresh(current_user)
    if old_avatar_key and old_avatar_key != object_key:
        media_service.delete_object(old_avatar_key)
    return _serialize_user(current_user, media_service)


@router.get("/{user_id}", response_model=UserRead)
async def get_user(user_id: UUID, session: AsyncSession = Depends(get_session), _: User = Depends(get_current_user)):
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    media_service = MediaService(session)
    return _serialize_user(user, media_service)
