from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any
from uuid import uuid4

from fastapi import WebSocket
from redis.exceptions import RedisError

from app.config import get_settings
from app.redis_client import redis_client

settings = get_settings()


class ConnectionManager:
    def __init__(self) -> None:
        self._node_id = uuid4().hex
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._server_subscriptions: dict[str, set[WebSocket]] = defaultdict(set)
        self._dm_subscriptions: dict[str, set[WebSocket]] = defaultdict(set)
        self._voice_subscriptions: dict[str, set[WebSocket]] = defaultdict(set)
        self._voice_members: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
        self._socket_voice_channel: dict[WebSocket, str] = {}
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
                await pubsub.psubscribe("server:*", "dm:*", "voice:*")
                async for message in pubsub.listen():
                    if message.get("type") != "pmessage":
                        continue
                    channel = message.get("channel")
                    data = message.get("data")
                    if not isinstance(channel, str) or not isinstance(data, str):
                        continue
                    payload = self._decode_pubsub_payload(data)
                    if payload is None:
                        continue
                    if channel.startswith("server:"):
                        server_id = channel.split(":", 1)[1]
                        await self._fanout(self._server_subscriptions.get(server_id, set()), payload)
                    elif channel.startswith("dm:"):
                        dm_id = channel.split(":", 1)[1]
                        await self._fanout(self._dm_subscriptions.get(dm_id, set()), payload)
                    elif channel.startswith("voice:"):
                        voice_channel_id = channel.split(":", 1)[1]
                        await self._fanout(self._voice_subscriptions.get(voice_channel_id, set()), payload)
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

    async def disconnect(self, user_id: str, websocket: WebSocket) -> dict[str, Any] | None:
        left_member = self._leave_voice_membership(websocket, user_id)

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

        return left_member

    async def subscribe_server(self, server_id: str, websocket: WebSocket) -> None:
        self._server_subscriptions[server_id].add(websocket)

    async def subscribe_dm(self, channel_id: str, websocket: WebSocket) -> None:
        self._dm_subscriptions[channel_id].add(websocket)

    async def send_to_user(self, user_id: str, payload: dict[str, Any]) -> None:
        await self._fanout(self._connections.get(user_id, set()), payload)

    async def publish_server(self, server_id: str, payload: dict[str, Any]) -> None:
        await self._fanout(self._server_subscriptions.get(server_id, set()), payload)
        try:
            await redis_client.publish(f"server:{server_id}", self._encode_pubsub_payload(payload))
        except RedisError:
            return

    async def publish_dm(self, channel_id: str, payload: dict[str, Any]) -> None:
        await self._fanout(self._dm_subscriptions.get(channel_id, set()), payload)
        try:
            await redis_client.publish(f"dm:{channel_id}", self._encode_pubsub_payload(payload))
        except RedisError:
            return

    async def publish_voice(self, channel_id: str, payload: dict[str, Any], *, exclude: set[WebSocket] | None = None) -> None:
        await self._fanout(self._voice_subscriptions.get(channel_id, set()), payload, exclude=exclude)
        try:
            await redis_client.publish(f"voice:{channel_id}", self._encode_pubsub_payload(payload))
        except RedisError:
            return

    async def join_voice(
        self,
        *,
        channel_id: str,
        server_id: str | None,
        user_id: str,
        username: str | None,
        avatar_url: str | None,
        websocket: WebSocket,
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None, dict[str, Any] | None]:
        left_member: dict[str, Any] | None = None
        previous_channel_id = self._socket_voice_channel.get(websocket)
        if previous_channel_id and previous_channel_id != channel_id:
            left_member = self._leave_voice_membership(websocket, user_id)

        self._voice_subscriptions[channel_id].add(websocket)
        self._socket_voice_channel[websocket] = channel_id

        members = self._voice_members[channel_id]
        existing_member = members.get(user_id)
        if existing_member is None:
            joined_member = {
                "user_id": user_id,
                "channel_id": channel_id,
                "server_id": server_id,
                "username": username,
                "avatar_url": avatar_url,
                "muted": False,
                "deafened": False,
            }
            members[user_id] = joined_member
        else:
            joined_member = None
            existing_member["channel_id"] = channel_id
            existing_member["server_id"] = server_id
            existing_member["username"] = username
            existing_member["avatar_url"] = avatar_url

        participants = list(self._voice_members[channel_id].values())
        return participants, joined_member, left_member

    async def leave_voice(self, *, user_id: str, websocket: WebSocket) -> dict[str, Any] | None:
        return self._leave_voice_membership(websocket, user_id)

    async def update_voice_state(self, *, user_id: str, websocket: WebSocket, muted: bool | None, deafened: bool | None) -> dict[str, Any] | None:
        channel_id = self._socket_voice_channel.get(websocket)
        if channel_id is None:
            return None

        members = self._voice_members.get(channel_id)
        if not members:
            return None

        member = members.get(user_id)
        if member is None:
            return None

        if isinstance(muted, bool):
            member["muted"] = muted
        if isinstance(deafened, bool):
            member["deafened"] = deafened
        return dict(member)

    def get_joined_voice_member(self, websocket: WebSocket, user_id: str) -> dict[str, Any] | None:
        channel_id = self._socket_voice_channel.get(websocket)
        if channel_id is None:
            return None
        members = self._voice_members.get(channel_id)
        if not members:
            return None
        member = members.get(user_id)
        if member is None:
            return None
        return dict(member)

    def _leave_voice_membership(self, websocket: WebSocket, user_id: str) -> dict[str, Any] | None:
        channel_id = self._socket_voice_channel.pop(websocket, None)
        if channel_id is None:
            return None

        self._voice_subscriptions[channel_id].discard(websocket)
        if not self._voice_subscriptions[channel_id]:
            self._voice_subscriptions.pop(channel_id, None)

        members = self._voice_members.get(channel_id)
        if not members:
            return None

        member = members.pop(user_id, None)
        if not members:
            self._voice_members.pop(channel_id, None)

        if member is None:
            return None

        return {
            "user_id": member.get("user_id", user_id),
            "channel_id": member.get("channel_id", channel_id),
            "server_id": member.get("server_id"),
            "username": member.get("username"),
            "avatar_url": member.get("avatar_url"),
            "muted": bool(member.get("muted", False)),
            "deafened": bool(member.get("deafened", False)),
        }

    async def _fanout(self, sockets: set[WebSocket], payload: dict[str, Any], *, exclude: set[WebSocket] | None = None) -> None:
        dead: list[WebSocket] = []
        serialized = json.dumps(payload)
        for socket in sockets:
            if exclude is not None and socket in exclude:
                continue
            try:
                await socket.send_text(serialized)
            except Exception:
                dead.append(socket)
        for socket in dead:
            sockets.discard(socket)

    def _encode_pubsub_payload(self, payload: dict[str, Any]) -> str:
        return json.dumps(
            {
                "_node_id": self._node_id,
                "payload": payload,
            }
        )

    def _decode_pubsub_payload(self, data: str) -> dict[str, Any] | None:
        try:
            decoded = json.loads(data)
        except json.JSONDecodeError:
            return None

        if not isinstance(decoded, dict):
            return None

        if "payload" in decoded:
            source_node_id = decoded.get("_node_id")
            if isinstance(source_node_id, str) and source_node_id == self._node_id:
                return None

            payload = decoded.get("payload")
            return payload if isinstance(payload, dict) else None

        return decoded


manager = ConnectionManager()
