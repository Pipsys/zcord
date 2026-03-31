from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.friend import Friend, FriendStatus
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.channel import ChannelRead
from app.schemas.friend import FriendRead, FriendRequestCreate, FriendRequestUpdate
from app.services.channel_access_service import get_or_create_dm_channel
from app.services.media_service import MediaService
from app.services.presence_service import PresenceSnapshot, get_presence_map, was_recently_online

router = APIRouter(prefix="/friends", tags=["friends"])


async def _load_user_profiles(session: AsyncSession, relations: list[Friend]) -> dict[UUID, dict[str, str | None]]:
    user_ids = {relation.requester_id for relation in relations} | {relation.addressee_id for relation in relations}
    if not user_ids:
        return {}

    users = await session.execute(select(User.id, User.username, User.avatar_url, User.banner_url).where(User.id.in_(user_ids)))
    media_service = MediaService(session)
    return {
        row.id: {
            "username": row.username,
            "avatar_url": media_service.resolve_public_url(row.avatar_url),
            "banner_url": media_service.resolve_public_url(row.banner_url),
        }
        for row in users.all()
    }


def _serialize_relation(
    relation: Friend,
    profiles: dict[UUID, dict[str, str | None]],
    *,
    current_user_id: UUID,
    presence_by_user: dict[str, PresenceSnapshot],
) -> FriendRead:
    requester = profiles.get(relation.requester_id, {})
    addressee = profiles.get(relation.addressee_id, {})
    peer_id = relation.addressee_id if relation.requester_id == current_user_id else relation.requester_id
    peer_presence = presence_by_user.get(str(peer_id), PresenceSnapshot(is_online=False, last_seen_at=None))
    return FriendRead(
        requester_id=relation.requester_id,
        addressee_id=relation.addressee_id,
        requester_username=requester.get("username") if isinstance(requester, dict) else None,
        addressee_username=addressee.get("username") if isinstance(addressee, dict) else None,
        requester_avatar_url=requester.get("avatar_url") if isinstance(requester, dict) else None,
        addressee_avatar_url=addressee.get("avatar_url") if isinstance(addressee, dict) else None,
        requester_banner_url=requester.get("banner_url") if isinstance(requester, dict) else None,
        addressee_banner_url=addressee.get("banner_url") if isinstance(addressee, dict) else None,
        peer_is_online=peer_presence.is_online,
        peer_was_recently_online=was_recently_online(peer_presence),
        peer_last_seen_at=peer_presence.last_seen_at,
        status=relation.status,
        created_at=relation.created_at,
    )


@router.get("", response_model=list[FriendRead])
async def list_friends(session: AsyncSession = Depends(get_session), current_user: User = Depends(get_current_user)):
    stmt = select(Friend).where(
        or_(Friend.requester_id == current_user.id, Friend.addressee_id == current_user.id)
    )
    rows = (await session.execute(stmt)).scalars().all()
    profiles = await _load_user_profiles(session, rows)
    presence_by_user = await get_presence_map(
        str(user_id)
        for relation in rows
        for user_id in (relation.requester_id, relation.addressee_id)
    )
    return [
        _serialize_relation(item, profiles, current_user_id=current_user.id, presence_by_user=presence_by_user)
        for item in rows
    ]


@router.post("", response_model=FriendRead, status_code=status.HTTP_201_CREATED)
async def send_friend_request(
    payload: FriendRequestCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if payload.addressee_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot add yourself")

    existing = (
        await session.execute(
            select(Friend).where(
                or_(
                    and_(Friend.requester_id == current_user.id, Friend.addressee_id == payload.addressee_id),
                    and_(Friend.requester_id == payload.addressee_id, Friend.addressee_id == current_user.id),
                )
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Friend request already exists")

    relation = Friend(requester_id=current_user.id, addressee_id=payload.addressee_id, status=FriendStatus.pending)
    session.add(relation)
    await session.commit()
    await session.refresh(relation)
    profiles = await _load_user_profiles(session, [relation])
    presence_by_user = await get_presence_map((str(relation.requester_id), str(relation.addressee_id)))
    return _serialize_relation(relation, profiles, current_user_id=current_user.id, presence_by_user=presence_by_user)


@router.patch("/{requester_id}", response_model=FriendRead)
async def update_friend_request(
    requester_id: UUID,
    payload: FriendRequestUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    relation = await session.get(Friend, {"requester_id": requester_id, "addressee_id": current_user.id})
    if relation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friend request not found")

    relation.status = payload.status
    await session.commit()
    await session.refresh(relation)
    profiles = await _load_user_profiles(session, [relation])
    presence_by_user = await get_presence_map((str(relation.requester_id), str(relation.addressee_id)))
    return _serialize_relation(relation, profiles, current_user_id=current_user.id, presence_by_user=presence_by_user)


@router.post("/{friend_id}/dm", response_model=ChannelRead)
async def open_direct_message(
    friend_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    channel = await get_or_create_dm_channel(session, current_user.id, friend_id)
    return ChannelRead.model_validate(channel, from_attributes=True)
