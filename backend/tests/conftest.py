from __future__ import annotations

import os
import uuid
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault("ENV", "test")
os.environ.setdefault("DEBUG", "false")
os.environ.setdefault("DATABASE_URL", os.getenv("TEST_DATABASE_URL", "postgresql+asyncpg://pawcord:pawcord@localhost:5432/pawcord_test"))

from app.config import get_settings

get_settings.cache_clear()

from app.database import Base, get_session
from app.main import app

settings = get_settings()


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session")
async def engine():
    engine = create_async_engine(settings.database_url, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest.fixture
async def db_session(engine) -> AsyncGenerator[AsyncSession, None]:
    async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with async_session() as session:
        yield session
        await session.rollback()


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def _override_get_session():
        yield db_session

    app.dependency_overrides[get_session] = _override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def auth_headers(client: AsyncClient) -> dict[str, str]:
    email = f"u-{uuid.uuid4()}@pawcord.local"
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
