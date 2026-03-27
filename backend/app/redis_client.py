from __future__ import annotations

from collections.abc import AsyncGenerator

from redis.asyncio import Redis

from app.config import get_settings

settings = get_settings()

redis_client = Redis.from_url(
    settings.redis_url,
    decode_responses=True,
    encoding="utf-8",
)


async def get_redis() -> AsyncGenerator[Redis, None]:
    yield redis_client
