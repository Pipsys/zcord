from __future__ import annotations

import uuid

import pytest


@pytest.mark.anyio
async def test_register_and_login(client):
    username = f"paw-{uuid.uuid4().hex[:8]}"
    email = f"{username}@example.com"

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
    email = f"{username}@example.com"

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
async def test_logout_login_logout_smoke(client):
    username = f"paw-{uuid.uuid4().hex[:8]}"
    email = f"{username}@example.com"
    password = "S3cretPass!"

    register = await client.post(
        "/api/v1/auth/register",
        json={"username": username, "email": email, "password": password, "public_key": None},
    )
    assert register.status_code == 201
    first_access = register.json()["token"]["access_token"]
    first_refresh = register.json()["refresh_token"]
    assert isinstance(first_refresh, str) and first_refresh

    client.cookies.clear()
    first_logout = await client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {first_access}"},
        json={"refresh_token": first_refresh},
    )
    assert first_logout.status_code == 200
    assert first_logout.json()["ok"] is True

    client.cookies.clear()
    first_refresh_attempt = await client.post("/api/v1/auth/refresh", json={"refresh_token": first_refresh})
    assert first_refresh_attempt.status_code == 401

    login = await client.post("/api/v1/auth/login", json={"login": email, "password": password})
    assert login.status_code == 200
    second_access = login.json()["token"]["access_token"]
    second_refresh = login.json()["refresh_token"]
    assert isinstance(second_refresh, str) and second_refresh
    assert second_access != first_access
    assert second_refresh != first_refresh

    me = await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {second_access}"})
    assert me.status_code == 200
    assert me.json()["email"] == email

    client.cookies.clear()
    second_logout = await client.post(
        "/api/v1/auth/logout",
        headers={"Authorization": f"Bearer {second_access}"},
        json={"refresh_token": second_refresh},
    )
    assert second_logout.status_code == 200
    assert second_logout.json()["ok"] is True

    client.cookies.clear()
    second_refresh_attempt = await client.post("/api/v1/auth/refresh", json={"refresh_token": second_refresh})
    assert second_refresh_attempt.status_code == 401


@pytest.mark.anyio
async def test_invalid_credentials(client):
    username = f"paw-{uuid.uuid4().hex[:8]}"
    email = f"{username}@example.com"

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
            json={"login": "none@example.com", "password": "badpassword"},
        )
        responses.append(resp.status_code)

    assert 429 in responses
