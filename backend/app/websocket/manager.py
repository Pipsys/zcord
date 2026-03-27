from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any

from fastapi import WebSocket
from redis.exceptions import RedisError

from app.config import get_settings
from app.redis_client import redis_client

settings = get_settings()


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._server_subscriptions: dict[str, set[WebSocket]] = defaultdict(set)
        self._dm_subscriptions: dict[str, set[WebSocket]] = defaultdict(set)
        self._pubsub_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    async def start_pubsub(self) -> None:
        async with self._lock:
            if self._pubsub_task is None or self._pubsub_task.done():
                self._pubsub_task = asyncio.create_task(self._consume_pubsub())

    async def _consume_pubsub(self) -> None:
        while True:
            pubsub = redis_client.pubsub()
            try:
                await pubsub.psubscribe("server:*", "dm:*")
                async for message in pubsub.listen():
                    if message.get("type") != "pmessage":
                        continue
                    channel = message.get("channel")
                    data = message.get("data")
                    if not isinstance(channel, str) or not isinstance(data, str):
                        continue
                    payload = json.loads(data)
                    if channel.startswith("server:"):
                        server_id = channel.split(":", 1)[1]
                        await self._fanout(self._server_subscriptions.get(server_id, set()), payload)
                    elif channel.startswith("dm:"):
                        dm_id = channel.split(":", 1)[1]
                        await self._fanout(self._dm_subscriptions.get(dm_id, set()), payload)
            except RedisError:
                await asyncio.sleep(2)
            finally:
                await pubsub.close()

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[user_id].add(websocket)
        try:
            await redis_client.setex(f"presence:{user_id}", settings.presence_ttl_seconds, "online")
        except RedisError:
            pass

    async def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        self._connections[user_id].discard(websocket)
        for group in self._server_subscriptions.values():
            group.discard(websocket)
        for group in self._dm_subscriptions.values():
            group.discard(websocket)
        if not self._connections[user_id]:
            self._connections.pop(user_id, None)
            try:
                await redis_client.delete(f"presence:{user_id}")
            except RedisError:
                pass

    async def subscribe_server(self, server_id: str, websocket: WebSocket) -> None:
        self._server_subscriptions[server_id].add(websocket)

    async def subscribe_dm(self, channel_id: str, websocket: WebSocket) -> None:
        self._dm_subscriptions[channel_id].add(websocket)

    async def send_to_user(self, user_id: str, payload: dict[str, Any]) -> None:
        await self._fanout(self._connections.get(user_id, set()), payload)

    async def publish_server(self, server_id: str, payload: dict[str, Any]) -> None:
        await self._fanout(self._server_subscriptions.get(server_id, set()), payload)
        try:
            await redis_client.publish(f"server:{server_id}", json.dumps(payload))
        except RedisError:
            return

    async def publish_dm(self, channel_id: str, payload: dict[str, Any]) -> None:
        await self._fanout(self._dm_subscriptions.get(channel_id, set()), payload)
        try:
            await redis_client.publish(f"dm:{channel_id}", json.dumps(payload))
        except RedisError:
            return

    async def _fanout(self, sockets: set[WebSocket], payload: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        serialized = json.dumps(payload)
        for socket in sockets:
            try:
                await socket.send_text(serialized)
            except Exception:
                dead.append(socket)
        for socket in dead:
            sockets.discard(socket)


manager = ConnectionManager()
