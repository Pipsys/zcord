from __future__ import annotations

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel, ChannelType
from app.models.friend import Friend, FriendStatus
from app.models.member import Member
from app.models.user import User

DM_PREFIX = "dm:"


def build_dm_channel_name(user_a: UUID, user_b: UUID) -> str:
    left, right = sorted((str(user_a), str(user_b)))
    return f"{DM_PREFIX}{left}:{right}"


def parse_dm_channel_name(value: str) -> tuple[UUID, UUID] | None:
    if not value.startswith(DM_PREFIX):
        return None
    parts = value.split(":")
    if len(parts) != 3:
        return None
    try:
        return UUID(parts[1]), UUID(parts[2])
    except ValueError:
        return None


async def list_user_dm_channels(session: AsyncSession, user_id: UUID) -> list[Channel]:
    stmt = select(Channel).where(
        Channel.server_id.is_(None),
        Channel.type == ChannelType.dm,
    )
    channels = (await session.execute(stmt.order_by(Channel.created_at.desc()))).scalars().all()
    result: list[Channel] = []
    for channel in channels:
        participants = parse_dm_channel_name(channel.name)
        if participants is None:
            continue
        if user_id in participants:
            result.append(channel)
    return result


async def assert_user_can_access_channel(session: AsyncSession, channel: Channel, user_id: UUID) -> None:
    if channel.server_id is not None:
        member = await session.get(Member, {"server_id": channel.server_id, "user_id": user_id})
        if member is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a server member")
        return

    if channel.type == ChannelType.dm:
        participants = parse_dm_channel_name(channel.name)
        if participants is None or user_id not in participants:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot access DM channel")
        return

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot access channel")


async def get_or_create_dm_channel(session: AsyncSession, current_user_id: UUID, friend_id: UUID) -> Channel:
    if friend_id == current_user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot create DM with yourself")

    friend_user = await session.get(User, friend_id)
    if friend_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    relation = (
        await session.execute(
            select(Friend).where(
                or_(
                    and_(Friend.requester_id == current_user_id, Friend.addressee_id == friend_id),
                    and_(Friend.requester_id == friend_id, Friend.addressee_id == current_user_id),
                )
            )
        )
    ).scalar_one_or_none()

    if relation is None or relation.status != FriendStatus.accepted:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Friendship is not accepted")

    dm_name = build_dm_channel_name(current_user_id, friend_id)
    existing = (
        await session.execute(
            select(Channel).where(
                Channel.server_id.is_(None),
                Channel.type == ChannelType.dm,
                Channel.name == dm_name,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    channel = Channel(
        server_id=None,
        type=ChannelType.dm,
        name=dm_name,
        topic=None,
        position=0,
        is_nsfw=False,
        slowmode_delay=0,
        parent_id=None,
    )
    session.add(channel)
    await session.commit()
    await session.refresh(channel)
    return channel
