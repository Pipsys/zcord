from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.member import Member
from app.models.server import Server
from app.models.server_invite import ServerInvite
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.server import ServerRead
from app.services.invite_service import invite_is_active, utcnow
from app.services.media_service import MediaService

router = APIRouter(prefix="/invites", tags=["invites"])


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


@router.post("/{code}/join", response_model=ServerRead)
async def join_server_by_invite(
    code: str = Path(..., min_length=8, max_length=64),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    media_service = MediaService(session)
    now = utcnow()

    invite_stmt = select(ServerInvite).where(ServerInvite.code == code).with_for_update()
    invite = (await session.execute(invite_stmt)).scalar_one_or_none()
    if invite is None or not invite_is_active(invite, now):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite is invalid or expired")

    server = await session.get(Server, invite.server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite is invalid or expired")

    membership = await session.get(Member, {"server_id": invite.server_id, "user_id": current_user.id})
    if membership is None:
        session.add(Member(server_id=invite.server_id, user_id=current_user.id))
        invite.uses_count = invite.uses_count + 1
        invite.last_used_at = now
        await session.commit()

    await session.refresh(server)
    return _serialize_server(server, media_service)
