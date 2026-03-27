from __future__ import annotations

import uuid
from uuid import UUID

import pytest

from app.models.member import Member, MemberRole
from app.models.role import Role
from app.services.permission_service import Permission


async def _register(client, suffix: str) -> tuple[str, str]:
    username = f"perm-{suffix}"
    email = f"{username}@example.com"
    response = await client.post(
        "/api/v1/auth/register",
        json={"username": username, "email": email, "password": "S3cretPass!", "public_key": None},
    )
    assert response.status_code == 201
    body = response.json()
    return body["token"]["access_token"], body["user"]["id"]


@pytest.mark.anyio
async def test_role_based_channel_permission(client, db_session):
    owner_token, _ = await _register(client, uuid.uuid4().hex[:8])
    member_token, member_user_id = await _register(client, uuid.uuid4().hex[:8])

    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    member_headers = {"Authorization": f"Bearer {member_token}"}

    server = await client.post(
        "/api/v1/servers",
        json={"name": "PermServer", "icon_url": None, "banner_url": None, "region": "us", "is_nsfw": False},
        headers=owner_headers,
    )
    assert server.status_code == 201
    server_id = UUID(server.json()["id"])
    member_uuid = UUID(member_user_id)

    db_session.add(Member(server_id=server_id, user_id=member_uuid))
    await db_session.commit()

    denied = await client.post(
        "/api/v1/channels",
        json={
            "server_id": str(server_id),
            "type": "text",
            "name": "no-access",
            "topic": None,
            "position": 0,
            "is_nsfw": False,
            "slowmode_delay": 0,
            "parent_id": None,
        },
        headers=member_headers,
    )
    assert denied.status_code == 403

    role = Role(
        server_id=server_id,
        name="Moderator",
        permissions=int(Permission.MANAGE_CHANNELS | Permission.VIEW_CHANNEL),
        position=1,
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(MemberRole(member_server_id=server_id, member_user_id=member_uuid, role_id=role.id))
    await db_session.commit()

    allowed = await client.post(
        "/api/v1/channels",
        json={
            "server_id": str(server_id),
            "type": "text",
            "name": "allowed",
            "topic": None,
            "position": 0,
            "is_nsfw": False,
            "slowmode_delay": 0,
            "parent_id": None,
        },
        headers=member_headers,
    )
    assert allowed.status_code == 201
