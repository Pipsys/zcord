from __future__ import annotations

import uuid

import pytest

from app.services.encryption_service import EncryptionService


async def _register(client, suffix: str) -> str:
    username = f"u-{suffix}"
    email = f"{username}@pawcord.local"
    response = await client.post(
        "/api/v1/auth/register",
        json={"username": username, "email": email, "password": "S3cretPass!", "public_key": None},
    )
    assert response.status_code == 201
    return response.json()["token"]["access_token"]


@pytest.mark.anyio
async def test_message_crud_pagination_and_reactions(client):
    token = await _register(client, uuid.uuid4().hex[:8])
    headers = {"Authorization": f"Bearer {token}"}

    server = await client.post(
        "/api/v1/servers",
        json={"name": "Paws", "icon_url": None, "banner_url": None, "region": "eu", "is_nsfw": False},
        headers=headers,
    )
    assert server.status_code == 201
    server_id = server.json()["id"]

    channel = await client.post(
        "/api/v1/channels",
        json={
            "server_id": server_id,
            "type": "text",
            "name": "general",
            "topic": "chat",
            "position": 0,
            "is_nsfw": False,
            "slowmode_delay": 0,
            "parent_id": None,
        },
        headers=headers,
    )
    assert channel.status_code == 201
    channel_id = channel.json()["id"]

    created_ids: list[str] = []
    for index in range(3):
        message = await client.post(
            "/api/v1/messages",
            json={"channel_id": channel_id, "content": f"hello {index}", "nonce": None, "type": "default", "reference_id": None},
            headers=headers,
        )
        assert message.status_code == 201
        created_ids.append(message.json()["id"])

    listing = await client.get(f"/api/v1/messages?channel_id={channel_id}&limit=2", headers=headers)
    assert listing.status_code == 200
    assert len(listing.json()) == 2

    update = await client.patch(
        f"/api/v1/messages/{created_ids[-1]}",
        json={"content": "edited"},
        headers=headers,
    )
    assert update.status_code == 200
    assert update.json()["content"] == "edited"

    reaction = await client.post(
        f"/api/v1/messages/{created_ids[-1]}/reactions",
        json={"emoji": "🐾"},
        headers=headers,
    )
    assert reaction.status_code == 201

    remove_reaction = await client.delete(f"/api/v1/messages/{created_ids[-1]}/reactions/%F0%9F%90%BE", headers=headers)
    assert remove_reaction.status_code == 204

    deleted = await client.delete(f"/api/v1/messages/{created_ids[-1]}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json()["deleted_at"] is not None


@pytest.mark.anyio
async def test_dm_encryption_roundtrip():
    sender_private, sender_public = EncryptionService.generate_keypair()
    recipient_private, recipient_public = EncryptionService.generate_keypair()

    ciphertext, nonce = EncryptionService.encrypt_dm(sender_private, recipient_public, "secret paw message")
    plaintext = EncryptionService.decrypt_dm(recipient_private, sender_public, ciphertext, nonce)

    assert plaintext == "secret paw message"
