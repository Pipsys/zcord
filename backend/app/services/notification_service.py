from __future__ import annotations

from arq import create_pool
from arq.connections import RedisSettings

from app.config import get_settings

settings = get_settings()


class NotificationService:
    def __init__(self) -> None:
        self._redis_settings = RedisSettings.from_dsn(settings.redis_url)
        self._pool = None

    async def _pool_instance(self):
        if self._pool is None:
            self._pool = await create_pool(self._redis_settings)
        return self._pool

    async def queue_notification(self, user_id: str, payload: dict[str, object]) -> None:
        pool = await self._pool_instance()
        await pool.enqueue_job("send_notification", user_id=user_id, payload=payload)

    async def queue_email(self, email: str, subject: str, body: str) -> None:
        pool = await self._pool_instance()
        await pool.enqueue_job("send_email", email=email, subject=subject, body=body)
