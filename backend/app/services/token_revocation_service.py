from __future__ import annotations

from datetime import UTC, datetime

from redis.exceptions import RedisError

from app.redis_client import redis_client


async def revoke_jti(jti: str, exp_ts: int) -> None:
    ttl = max(1, exp_ts - int(datetime.now(UTC).timestamp()))
    try:
        await redis_client.setex(f"revoked_jti:{jti}", ttl, "1")
    except RedisError:
        return


async def is_jti_revoked(jti: str) -> bool:
    try:
        value = await redis_client.get(f"revoked_jti:{jti}")
    except RedisError:
        return False
    return value == "1"
