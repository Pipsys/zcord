from __future__ import annotations

import uuid

import pytest


@pytest.mark.anyio
async def test_register_and_login(client):
    username = f"paw-{uuid.uuid4().hex[:8]}"
    email = f"{username}@pawcord.local"

    register = await client.post(
        "/api/v1/auth/register",
        json={"username": username, "email": email, "password": "S3cretPass!", "public_key": None},
    )
    assert register.status_code == 201
    body = register.json()
    assert body["token"]["access_token"]
    assert body["user"]["username"] == username

    login = await client.post("/api/v1/auth/login", json={"login": email, "password": "S3cretPass!"})
    assert login.status_code == 200
    assert login.json()["token"]["access_token"]


@pytest.mark.anyio
async def test_refresh_and_logout(client):
    username = f"paw-{uuid.uuid4().hex[:8]}"
    email = f"{username}@pawcord.local"

    reg = await client.post(
        "/api/v1/auth/register",
        json={"username": username, "email": email, "password": "S3cretPass!", "public_key": None},
    )
    assert reg.status_code == 201
    token = reg.json()["token"]["access_token"]

    refresh = await client.post("/api/v1/auth/refresh")
    assert refresh.status_code == 200
    refreshed = refresh.json()["token"]["access_token"]
    assert refreshed != token

    logout = await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {refreshed}"})
    assert logout.status_code == 200
    assert logout.json()["ok"] is True


@pytest.mark.anyio
async def test_invalid_credentials(client):
    username = f"paw-{uuid.uuid4().hex[:8]}"
    email = f"{username}@pawcord.local"

    await client.post(
        "/api/v1/auth/register",
        json={"username": username, "email": email, "password": "S3cretPass!", "public_key": None},
    )

    failed = await client.post("/api/v1/auth/login", json={"login": email, "password": "WrongPass123"})
    assert failed.status_code == 401


@pytest.mark.anyio
async def test_auth_rate_limit(client):
    responses = []
    for _ in range(10):
        resp = await client.post(
            "/api/v1/auth/login",
            json={"login": "none@pawcord.local", "password": "badpassword"},
        )
        responses.append(resp.status_code)

    assert 429 in responses
