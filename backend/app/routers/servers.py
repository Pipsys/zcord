from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.member import Member, MemberRole
from app.models.role import Role
from app.models.server import Server
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.server import ServerCreate, ServerRead, ServerUpdate
from app.services.permission_service import Permission

router = APIRouter(prefix="/servers", tags=["servers"])


@router.get("", response_model=list[ServerRead])
async def list_servers(session: AsyncSession = Depends(get_session), current_user: User = Depends(get_current_user)):
    stmt = (
        select(Server)
        .join(Member, Member.server_id == Server.id)
        .where(Member.user_id == current_user.id)
        .order_by(Server.created_at.desc())
    )
    servers = (await session.execute(stmt)).scalars().all()
    return [ServerRead.model_validate(server, from_attributes=True) for server in servers]


@router.post("", response_model=ServerRead, status_code=status.HTTP_201_CREATED)
async def create_server(
    payload: ServerCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
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
    return ServerRead.model_validate(server, from_attributes=True)


@router.post("/{server_id}/join", response_model=ServerRead)
async def join_server(
    server_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    server = await session.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    membership = await session.get(Member, {"server_id": server_id, "user_id": current_user.id})
    if membership is None:
        session.add(Member(server_id=server_id, user_id=current_user.id))
        await session.commit()
        await session.refresh(server)

    return ServerRead.model_validate(server, from_attributes=True)


@router.patch("/{server_id}", response_model=ServerRead)
async def update_server(
    server_id: UUID,
    payload: ServerUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    server = await session.get(Server, server_id)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    if server.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only server owner can update")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(server, key, value)

    await session.commit()
    await session.refresh(server)
    return ServerRead.model_validate(server, from_attributes=True)


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
