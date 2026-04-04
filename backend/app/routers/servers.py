from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.member import Member, MemberRole
from app.models.role import Role
from app.models.server import Server
from app.models.server_invite import ServerInvite
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.invite import ServerInviteCreate, ServerInviteRead
from app.schemas.server import ServerCreate, ServerMemberRead, ServerRead, ServerUpdate
from app.services.invite_service import build_public_invite_url, generate_invite_code, utcnow
from app.services.media_service import MediaService
from app.services.permission_service import Permission
from app.services.presence_service import PresenceSnapshot, get_presence_map, was_recently_online

router = APIRouter(prefix="/servers", tags=["servers"])


def _serialize_server(server: Server, media_service: MediaService) -> ServerRead:
    return ServerRead.model_validate(
        {
            "id": server.id,
            "name": server.name,
            "icon_url": media_service.resolve_public_url(server.icon_url),
            "banner_url": media_service.resolve_public_url(server.banner_url),
            "owner_id": server.owner_id,
            "region": server.region,
            "is_nsfw": server.is_nsfw,
            "max_members": server.max_members,
            "created_at": server.created_at,
        }
    )


@router.get("", response_model=list[ServerRead])
async def list_servers(session: AsyncSession = Depends(get_session), current_user: User = Depends(get_current_user)):
    stmt = (
        select(Server)
        .join(Member, Member.server_id == Server.id)
        .where(Member.user_id == current_user.id)
        .order_by(Server.created_at.desc())
    )
    servers = (await session.execute(stmt)).scalars().all()
    media_service = MediaService(session)
    return [_serialize_server(server, media_service) for server in servers]


@router.post("", response_model=ServerRead, status_code=status.HTTP_201_CREATED)
async def create_server(
    payload: ServerCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    media_service = MediaService(session)
    server = Server(
        name=payload.name,
        icon_url=payload.icon_url,
        banner_url=payload.banner_url,
        owner_id=current_user.id,
        region=payload.region,
        is_nsfw=payload.is_nsfw,
    )
    session.add(server)
    await session.flush()

    session.add(Member(server_id=server.id, user_id=current_user.id))
    owner_role = Role(
        server_id=server.id,
        name="Owner",
        color=0xFF7B35,
        permissions=int(
            Permission.VIEW_CHANNEL
            | Permission.SEND_MESSAGES
            | Permission.MANAGE_CHANNELS
            | Permission.MANAGE_SERVER
            | Permission.MANAGE_MESSAGES
            | Permission.CONNECT
            | Permission.SPEAK
        ),
        position=0,
        is_mentionable=False,
        is_hoisted=True,
    )
    session.add(owner_role)
    await session.flush()
    session.add(
        MemberRole(
            member_server_id=server.id,
            member_user_id=current_user.id,
            role_id=owner_role.id,
        )
    )
    await session.commit()
    await session.refresh(server)
    return _serialize_server(server, media_service)


@router.post("/{server_id}/join", response_model=ServerRead)
async def join_server(
    server_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    media_service = MediaService(session)
    server = await session.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    membership = await session.get(Member, {"server_id": server_id, "user_id": current_user.id})
    if membership is None:
        session.add(Member(server_id=server_id, user_id=current_user.id))
        await session.commit()
        await session.refresh(server)

    return _serialize_server(server, media_service)


@router.post("/{server_id}/invites", response_model=ServerInviteRead, status_code=status.HTTP_201_CREATED)
async def create_server_invite(
    server_id: UUID,
    payload: ServerInviteCreate | None = None,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    server = await session.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    membership = await session.get(Member, {"server_id": server_id, "user_id": current_user.id})
    if membership is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a server member")

    effective_payload = payload or ServerInviteCreate()

    code: str | None = None
    for _ in range(8):
        candidate = generate_invite_code()
        existing = await session.get(ServerInvite, candidate)
        if existing is None:
            code = candidate
            break
    if code is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Invite generation failed")

    now = utcnow()
    invite = ServerInvite(
        code=code,
        server_id=server_id,
        created_by=current_user.id,
        expires_at=now + timedelta(hours=effective_payload.expires_in_hours),
        max_uses=effective_payload.max_uses,
        uses_count=0,
    )
    session.add(invite)
    await session.commit()
    await session.refresh(invite)

    return ServerInviteRead.model_validate(
        {
            "code": invite.code,
            "server_id": invite.server_id,
            "invite_url": build_public_invite_url(invite.code),
            "expires_at": invite.expires_at,
            "max_uses": invite.max_uses,
            "uses_count": invite.uses_count,
            "created_at": invite.created_at,
        }
    )


@router.get("/{server_id}/members", response_model=list[ServerMemberRead])
async def list_server_members(
    server_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    membership = await session.get(Member, {"server_id": server_id, "user_id": current_user.id})
    if membership is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a server member")

    rows = (
        await session.execute(
            select(Member, User)
            .join(User, User.id == Member.user_id)
            .where(Member.server_id == server_id)
            .order_by(Member.joined_at.asc())
        )
    ).all()

    presence_by_user = await get_presence_map(str(user.id) for _, user in rows)
    media_service = MediaService(session)
    members: list[ServerMemberRead] = []
    for member, user in rows:
        presence_snapshot = presence_by_user.get(str(user.id), PresenceSnapshot(is_online=False, last_seen_at=None))
        members.append(
            ServerMemberRead.model_validate(
                {
                    "user_id": user.id,
                    "username": user.username,
                    "nickname": member.nickname,
                    "avatar_url": media_service.resolve_public_url(user.avatar_url),
                    "status": user.status,
                    "is_online": presence_snapshot.is_online,
                    "was_recently_online": was_recently_online(presence_snapshot),
                    "last_seen_at": presence_snapshot.last_seen_at,
                    "joined_at": member.joined_at,
                }
            )
        )
    return members


@router.post("/{server_id}/icon", response_model=ServerRead)
async def upload_server_icon(
    server_id: UUID,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    server = await session.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    if server.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only server owner can update")

    media_service = MediaService(session)
    old_icon_key = server.icon_url
    object_key = await media_service.upload_server_icon(server_id=server_id, upload_file=file)
    server.icon_url = object_key
    await session.commit()
    await session.refresh(server)

    if old_icon_key and old_icon_key != object_key:
        media_service.delete_object(old_icon_key)

    return _serialize_server(server, media_service)


@router.delete("/{server_id}/icon", response_model=ServerRead)
async def delete_server_icon(
    server_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    server = await session.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    if server.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only server owner can update")

    media_service = MediaService(session)
    old_icon_key = server.icon_url
    server.icon_url = None
    await session.commit()
    await session.refresh(server)

    if old_icon_key:
        media_service.delete_object(old_icon_key)

    return _serialize_server(server, media_service)


@router.post("/{server_id}/banner", response_model=ServerRead)
async def upload_server_banner(
    server_id: UUID,
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    server = await session.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    if server.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only server owner can update")

    media_service = MediaService(session)
    old_banner_key = server.banner_url
    object_key = await media_service.upload_server_banner(server_id=server_id, upload_file=file)
    server.banner_url = object_key
    await session.commit()
    await session.refresh(server)

    if old_banner_key and old_banner_key != object_key:
        media_service.delete_object(old_banner_key)

    return _serialize_server(server, media_service)


@router.patch("/{server_id}", response_model=ServerRead)
async def update_server(
    server_id: UUID,
    payload: ServerUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    media_service = MediaService(session)
    server = await session.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    if server.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only server owner can update")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(server, key, value)

    await session.commit()
    await session.refresh(server)
    return _serialize_server(server, media_service)


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(
    server_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    server = await session.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    if server.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only server owner can delete")

    await session.delete(server)
    await session.commit()
    return None


@router.delete("/{server_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_server(
    server_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    server = await session.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    if server.owner_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Server owner cannot leave server")

    membership = await session.get(Member, {"server_id": server_id, "user_id": current_user.id})
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")

    await session.delete(membership)
    await session.commit()
    return None
