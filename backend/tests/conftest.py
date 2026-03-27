from __future__ import annotations

import os
import uuid
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool


def _resolve_test_database_url() -> str:
    return os.getenv("TEST_DATABASE_URL") or os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://pawcord:pawcord@localhost:5432/pawcord",
    )


os.environ["ENV"] = "test"
os.environ["DEBUG"] = "false"
os.environ["DATABASE_URL"] = _resolve_test_database_url()

from app.config import get_settings

get_settings.cache_clear()

from app.database import Base, get_session
from app.main import app
from app.routers import auth as auth_router, deps as deps_router
from app.services import token_revocation_service
from app.websocket import handlers as websocket_handlers

settings = get_settings()


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture
def test_schema() -> str:
    return f'test_{uuid.uuid4().hex}'


@pytest.fixture
async def engine(test_schema: str):
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        poolclass=NullPool,
        connect_args={"server_settings": {"search_path": test_schema}},
    )
    async with engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{test_schema}"'))
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.execute(text(f'DROP SCHEMA IF EXISTS "{test_schema}" CASCADE'))
    await engine.dispose()


@pytest.fixture
async def db_session(engine) -> AsyncGenerator[AsyncSession, None]:
    async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with async_session() as session:
        yield session


@pytest.fixture(autouse=True)
def isolated_token_revocation(monkeypatch: pytest.MonkeyPatch) -> None:
    revoked_jtis: set[str] = set()

    async def _revoke_jti(jti: str, exp_ts: int) -> None:
        _ = exp_ts
        revoked_jtis.add(jti)

    async def _is_jti_revoked(jti: str) -> bool:
        return jti in revoked_jtis

    monkeypatch.setattr(token_revocation_service, "revoke_jti", _revoke_jti)
    monkeypatch.setattr(token_revocation_service, "is_jti_revoked", _is_jti_revoked)
    monkeypatch.setattr(auth_router, "revoke_jti", _revoke_jti)
    monkeypatch.setattr(deps_router, "is_jti_revoked", _is_jti_revoked)
    monkeypatch.setattr(websocket_handlers, "is_jti_revoked", _is_jti_revoked)


@pytest.fixture
async def client(engine) -> AsyncGenerator[AsyncClient, None]:
    async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def _override_get_session():
        async with async_session() as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def auth_headers(client: AsyncClient) -> dict[str, str]:
    email = f"u-{uuid.uuid4()}@example.com"
    username = f"u{uuid.uuid4().hex[:8]}"
    payload = {
        "username": username,
        "email": email,
        "password": "S3cretPass!",
        "public_key": None,
    }
    register = await client.post("/api/v1/auth/register", json=payload)
    assert register.status_code == 201
    token = register.json()["token"]["access_token"]
    return {"Authorization": f"Bearer {token}"}
