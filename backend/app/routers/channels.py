from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.channel import Channel
from app.models.member import Member
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.channel import ChannelCreate, ChannelRead, ChannelUpdate
from app.services.channel_access_service import assert_user_can_access_channel, list_user_dm_channels
from app.services.permission_service import Permission, check_permission

router = APIRouter(prefix="/channels", tags=["channels"])


async def _assert_membership(session: AsyncSession, server_id: UUID, user_id: UUID) -> None:
    member = await session.get(Member, {"server_id": server_id, "user_id": user_id})
    if member is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a server member")


@router.get("", response_model=list[ChannelRead])
async def list_channels(
    server_id: UUID | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if server_id is not None:
        await _assert_membership(session, server_id, current_user.id)
        stmt = select(Channel).where(Channel.server_id == server_id)
        channels = (await session.execute(stmt.order_by(Channel.position.asc()))).scalars().all()
    else:
        channels = await list_user_dm_channels(session, current_user.id)
    return [ChannelRead.model_validate(channel, from_attributes=True) for channel in channels]


@router.post("", response_model=ChannelRead, status_code=status.HTTP_201_CREATED)
async def create_channel(
    payload: ChannelCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if payload.server_id is not None:
        await _assert_membership(session, payload.server_id, current_user.id)
        perm = await check_permission(session, payload.server_id, current_user.id, Permission.MANAGE_CHANNELS)
        if not perm.granted:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing MANAGE_CHANNELS permission")
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Use DM endpoint to create direct channels")

    channel = Channel(**payload.model_dump())
    session.add(channel)
    await session.commit()
    await session.refresh(channel)
    return ChannelRead.model_validate(channel, from_attributes=True)


@router.patch("/{channel_id}", response_model=ChannelRead)
async def update_channel(
    channel_id: UUID,
    payload: ChannelUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")

    if channel.server_id is not None:
        await _assert_membership(session, channel.server_id, current_user.id)
        perm = await check_permission(session, channel.server_id, current_user.id, Permission.MANAGE_CHANNELS)
        if not perm.granted:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing MANAGE_CHANNELS permission")
    else:
        await assert_user_can_access_channel(session, channel, current_user.id)

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(channel, key, value)

    await session.commit()
    await session.refresh(channel)
    return ChannelRead.model_validate(channel, from_attributes=True)


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel(
    channel_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")

    if channel.server_id is not None:
        await _assert_membership(session, channel.server_id, current_user.id)
        perm = await check_permission(session, channel.server_id, current_user.id, Permission.MANAGE_CHANNELS)
        if not perm.granted:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing MANAGE_CHANNELS permission")
    else:
        await assert_user_can_access_channel(session, channel, current_user.id)

    await session.delete(channel)
    await session.commit()
    return None
