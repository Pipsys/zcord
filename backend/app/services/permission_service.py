from __future__ import annotations

from dataclasses import dataclass
from enum import IntFlag
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.member import MemberRole
from app.models.role import Role
from app.models.server import Server


class Permission(IntFlag):
    VIEW_CHANNEL = 1 << 0
    SEND_MESSAGES = 1 << 1
    MANAGE_CHANNELS = 1 << 2
    MANAGE_SERVER = 1 << 3
    MANAGE_MESSAGES = 1 << 4
    CONNECT = 1 << 5
    SPEAK = 1 << 6


@dataclass(frozen=True)
class PermissionCheck:
    granted: bool
    permissions: int


async def resolve_member_permissions(session: AsyncSession, server_id: UUID, user_id: UUID) -> int:
    stmt = (
        select(Role.permissions)
        .join(MemberRole, MemberRole.role_id == Role.id)
        .where(MemberRole.member_server_id == server_id, MemberRole.member_user_id == user_id)
    )
    rows = (await session.execute(stmt)).scalars().all()
    resolved = 0
    for value in rows:
        resolved |= int(value)
    return resolved


async def check_permission(session: AsyncSession, server_id: UUID, user_id: UUID, permission: Permission) -> PermissionCheck:
    server = await session.get(Server, server_id)
    if server is not None and server.owner_id == user_id:
        all_permissions = int(
            Permission.VIEW_CHANNEL
            | Permission.SEND_MESSAGES
            | Permission.MANAGE_CHANNELS
            | Permission.MANAGE_SERVER
            | Permission.MANAGE_MESSAGES
            | Permission.CONNECT
            | Permission.SPEAK
        )
        return PermissionCheck(granted=True, permissions=all_permissions)

    resolved = await resolve_member_permissions(session, server_id, user_id)
    return PermissionCheck(granted=bool(resolved & int(permission)), permissions=resolved)
