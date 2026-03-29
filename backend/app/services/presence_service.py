from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Iterable

from redis.exceptions import RedisError

from app.config import get_settings
from app.redis_client import redis_client

settings = get_settings()


@dataclass(frozen=True, slots=True)
class PresenceSnapshot:
    is_online: bool
    last_seen_at: datetime | None


def _presence_key(user_id: str) -> str:
    return f"presence:{user_id}"


def _last_seen_key(user_id: str) -> str:
    return f"presence:last_seen:{user_id}"


def _parse_last_seen(raw: str | None) -> datetime | None:
    if raw is None:
        return None
    try:
        timestamp = int(raw)
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(timestamp, tz=UTC)


def was_recently_online(snapshot: PresenceSnapshot) -> bool:
    if snapshot.is_online or snapshot.last_seen_at is None:
        return False
    return (datetime.now(UTC) - snapshot.last_seen_at) <= timedelta(seconds=settings.presence_recently_seconds)


async def mark_online(user_id: str) -> None:
    seen_at = datetime.now(UTC)
    seen_value = str(int(seen_at.timestamp()))
    try:
        pipeline = redis_client.pipeline()
        pipeline.setex(_presence_key(user_id), settings.presence_ttl_seconds, "online")
        pipeline.set(_last_seen_key(user_id), seen_value, ex=settings.presence_last_seen_ttl_seconds)
        await pipeline.execute()
    except RedisError:
        return


async def mark_offline(user_id: str, when: datetime | None = None) -> None:
    offline_at = when or datetime.now(UTC)
    last_seen_value = str(int(offline_at.timestamp()))
    try:
        pipeline = redis_client.pipeline()
        pipeline.delete(_presence_key(user_id))
        pipeline.set(_last_seen_key(user_id), last_seen_value, ex=settings.presence_last_seen_ttl_seconds)
        await pipeline.execute()
    except RedisError:
        return


async def get_presence_map(user_ids: Iterable[str]) -> dict[str, PresenceSnapshot]:
    unique_user_ids = list(dict.fromkeys(user_ids))
    if not unique_user_ids:
        return {}

    presence_keys = [_presence_key(user_id) for user_id in unique_user_ids]
    last_seen_keys = [_last_seen_key(user_id) for user_id in unique_user_ids]
    snapshots: dict[str, PresenceSnapshot] = {}
    try:
        pipeline = redis_client.pipeline()
        pipeline.mget(presence_keys)
        pipeline.mget(last_seen_keys)
        online_values, last_seen_values = await pipeline.execute()
    except RedisError:
        return {user_id: PresenceSnapshot(is_online=False, last_seen_at=None) for user_id in unique_user_ids}

    for index, user_id in enumerate(unique_user_ids):
        online_raw = online_values[index] if isinstance(online_values, list) and index < len(online_values) else None
        last_seen_raw = last_seen_values[index] if isinstance(last_seen_values, list) and index < len(last_seen_values) else None
        snapshots[user_id] = PresenceSnapshot(
            is_online=online_raw is not None,
            last_seen_at=_parse_last_seen(last_seen_raw if isinstance(last_seen_raw, str) else None),
        )
    return snapshots
