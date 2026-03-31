from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.user import UserRead, UserUpdate
from app.services.media_service import MediaService
from app.utils.password import hash_password, verify_password

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

    current_password = update_data.pop("current_password", None)
    new_password = update_data.pop("new_password", None)

    if (current_password is None) ^ (new_password is None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Both current_password and new_password are required to change password",
        )

    next_username = update_data.get("username")
    if isinstance(next_username, str) and next_username != current_user.username:
        username_exists_stmt = select(User.id).where(and_(User.username == next_username, User.id != current_user.id))
        username_exists = (await session.execute(username_exists_stmt)).scalar_one_or_none()
        if username_exists is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    next_email = update_data.get("email")
    if isinstance(next_email, str) and next_email != current_user.email:
        email_exists_stmt = select(User.id).where(and_(User.email == next_email, User.id != current_user.id))
        email_exists = (await session.execute(email_exists_stmt)).scalar_one_or_none()
        if email_exists is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    if current_password is not None and new_password is not None:
        if not verify_password(current_password, current_user.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
        if current_password == new_password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must differ from current password")
        current_user.password_hash = hash_password(new_password)

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

@router.post("/me/banner", response_model=UserRead)
async def upload_my_banner(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    media_service = MediaService(session)
    old_banner_key = current_user.banner_url
    object_key = await media_service.upload_user_banner(current_user.id, file)
    current_user.banner_url = object_key
    await session.commit()
    await session.refresh(current_user)
    if old_banner_key and old_banner_key != object_key:
        media_service.delete_object(old_banner_key)
    return _serialize_user(current_user, media_service)


@router.get("/{user_id}", response_model=UserRead)
async def get_user(user_id: UUID, session: AsyncSession = Depends(get_session), _: User = Depends(get_current_user)):
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    media_service = MediaService(session)
    return _serialize_user(user, media_service)
