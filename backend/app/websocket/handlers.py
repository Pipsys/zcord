from __future__ import annotations

from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import WebSocket
from jose import JWTError

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.message import Message, MessageReceipt
from app.services.token_revocation_service import is_jti_revoked
from app.utils.jwt_utils import decode_token
from app.websocket.events import ClientEventType, GatewayEventType
from app.websocket.manager import manager

settings = get_settings()


class EventRateLimiter:
    def __init__(self, max_events_per_second: int) -> None:
        self.max_events_per_second = max_events_per_second
        self._events: dict[int, deque[datetime]] = defaultdict(deque)

    def allow(self, websocket: WebSocket) -> bool:
        now = datetime.now(UTC)
        key = id(websocket)
        queue = self._events[key]
        cutoff = now - timedelta(seconds=1)
        while queue and queue[0] < cutoff:
            queue.popleft()
        if len(queue) >= self.max_events_per_second:
            return False
        queue.append(now)
        return True

    def clear(self, websocket: WebSocket) -> None:
        self._events.pop(id(websocket), None)


rate_limiter = EventRateLimiter(settings.websocket_event_limit_per_second)


async def authenticate_websocket_token(token: str) -> str:
    try:
        payload = decode_token(token, expected_type="access")
    except JWTError as exc:
        raise ValueError("Invalid websocket token") from exc

    jti = payload.get("jti")
    if isinstance(jti, str) and await is_jti_revoked(jti):
        raise ValueError("Token revoked")

    sub = payload.get("sub")
    if not isinstance(sub, str):
        raise ValueError("Invalid websocket token subject")
    return sub


async def _persist_message_receipt(
    channel_id: str,
    message_id: str,
    user_id: str,
    *,
    mark_read: bool,
) -> datetime | None:
    try:
        channel_uuid = UUID(channel_id)
        message_uuid = UUID(message_id)
        user_uuid = UUID(user_id)
    except ValueError:
        return None

    async with AsyncSessionLocal() as session:
        message = await session.get(Message, message_uuid)
        if message is None:
            return None
        if message.channel_id != channel_uuid:
            return None
        if message.author_id == user_uuid:
            return None

        receipt = await session.get(
            MessageReceipt,
            {"message_id": message_uuid, "user_id": user_uuid},
        )

        changed_at: datetime | None = None
        now = datetime.now(UTC)
        if receipt is None:
            receipt = MessageReceipt(
                message_id=message_uuid,
                user_id=user_uuid,
                delivered_at=now,
                read_at=now if mark_read else None,
            )
            session.add(receipt)
            changed_at = now
        else:
            if mark_read and receipt.read_at is None:
                receipt.read_at = now
                if receipt.delivered_at is None:
                    receipt.delivered_at = now
                changed_at = now
            elif not mark_read and receipt.delivered_at is None:
                receipt.delivered_at = now
                changed_at = now

        if changed_at is None:
            return None

        await session.commit()
        return changed_at


async def handle_client_event(user_id: str, websocket: WebSocket, event: dict[str, Any]) -> None:
    if not rate_limiter.allow(websocket):
        await websocket.send_json(
            {
                "op": "ERROR",
                "t": "RATE_LIMITED",
                "d": {"detail": "WebSocket event rate limit exceeded"},
            }
        )
        return

    event_type = event.get("t")
    data = event.get("d") if isinstance(event.get("d"), dict) else {}

    if event_type == ClientEventType.IDENTIFY.value:
        await websocket.send_json(
            {
                "op": "DISPATCH",
                "t": GatewayEventType.READY.value,
                "d": {
                    "user_id": user_id,
                    "client": data.get("client", "desktop"),
                },
            }
        )
        return

    if event_type == ClientEventType.HEARTBEAT.value:
        await websocket.send_json({"op": "DISPATCH", "t": GatewayEventType.HEARTBEAT_ACK.value, "d": {}})
        return

    if event_type == ClientEventType.SUBSCRIBE_SERVER.value:
        server_id = data.get("server_id")
        if isinstance(server_id, str):
            await manager.subscribe_server(server_id, websocket)
        channel_id = data.get("channel_id")
        if isinstance(channel_id, str):
            await manager.subscribe_dm(channel_id, websocket)
        return

    if event_type == ClientEventType.TYPING.value:
        payload = {
            "op": "DISPATCH",
            "t": GatewayEventType.TYPING_START.value,
            "d": {
                "channel_id": data.get("channel_id"),
                "user_id": user_id,
                "expires_at": (datetime.now(UTC) + timedelta(seconds=5)).isoformat(),
            },
        }
        server_id = data.get("server_id")
        channel_id = data.get("channel_id")
        if isinstance(server_id, str):
            await manager.publish_server(server_id, payload)
        elif isinstance(channel_id, str):
            await manager.publish_dm(channel_id, payload)
        return

    if event_type == ClientEventType.MESSAGE_DELIVERED_ACK.value:
        channel_id = data.get("channel_id")
        message_id = data.get("message_id")
        if not isinstance(channel_id, str) or not isinstance(message_id, str):
            return

        changed_at = await _persist_message_receipt(channel_id, message_id, user_id, mark_read=False)
        if changed_at is None:
            return

        payload = {
            "op": "DISPATCH",
            "t": GatewayEventType.MESSAGE_DELIVERED.value,
            "d": {
                "channel_id": channel_id,
                "message_id": message_id,
                "user_id": user_id,
                "at": changed_at.isoformat(),
            },
        }
        server_id = data.get("server_id")
        if isinstance(server_id, str):
            await manager.publish_server(server_id, payload)
        else:
            await manager.publish_dm(channel_id, payload)
        return

    if event_type == ClientEventType.MESSAGE_READ_ACK.value:
        channel_id = data.get("channel_id")
        message_id = data.get("message_id")
        if not isinstance(channel_id, str) or not isinstance(message_id, str):
            return

        changed_at = await _persist_message_receipt(channel_id, message_id, user_id, mark_read=True)
        if changed_at is None:
            return

        payload = {
            "op": "DISPATCH",
            "t": GatewayEventType.MESSAGE_READ.value,
            "d": {
                "channel_id": channel_id,
                "message_id": message_id,
                "user_id": user_id,
                "at": changed_at.isoformat(),
            },
        }
        server_id = data.get("server_id")
        if isinstance(server_id, str):
            await manager.publish_server(server_id, payload)
        else:
            await manager.publish_dm(channel_id, payload)
        return

    if event_type == ClientEventType.VOICE_SIGNAL.value:
        payload = {
            "op": "DISPATCH",
            "t": GatewayEventType.VOICE_STATE_UPDATE.value,
            "d": {
                "user_id": user_id,
                "channel_id": data.get("channel_id"),
                "signal": data,
            },
        }
        server_id = data.get("server_id")
        channel_id = data.get("channel_id")
        if isinstance(server_id, str):
            await manager.publish_server(server_id, payload)
        elif isinstance(channel_id, str):
            await manager.publish_dm(channel_id, payload)
        return

    await websocket.send_json(
        {
            "op": "ERROR",
            "t": "UNKNOWN_EVENT",
            "d": {"detail": f"Unsupported event: {event_type}"},
        }
    )
