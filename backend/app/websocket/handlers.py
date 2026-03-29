from __future__ import annotations

from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
import logging
from typing import Any
from uuid import UUID

from fastapi import HTTPException, WebSocket
from jose import JWTError
from sqlalchemy import select

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.channel import Channel, ChannelType
from app.models.message import Message, MessageReceipt
from app.models.user import User
from app.services.channel_access_service import assert_user_can_access_channel
from app.services.media_service import MediaService
from app.services.token_revocation_service import is_jti_revoked
from app.utils.jwt_utils import decode_token
from app.websocket.events import ClientEventType, GatewayEventType
from app.websocket.manager import manager

settings = get_settings()
logger = logging.getLogger(__name__)


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


async def _validate_voice_channel_access(channel_id: str, user_id: str) -> Channel | None:
    try:
        channel_uuid = UUID(channel_id)
        user_uuid = UUID(user_id)
    except ValueError:
        return None

    async with AsyncSessionLocal() as session:
        channel = await session.get(Channel, channel_uuid)
        if channel is None:
            return None
        if channel.type != ChannelType.voice:
            return None

        try:
            await assert_user_can_access_channel(session, channel, user_uuid)
        except HTTPException:
            return None

        return channel


async def _load_voice_user_profile(user_id: str) -> tuple[str | None, str | None]:
    try:
        user_uuid = UUID(user_id)
    except ValueError:
        return None, None

    async with AsyncSessionLocal() as session:
        row = (
            await session.execute(
                select(User.username, User.avatar_url).where(User.id == user_uuid)
            )
        ).one_or_none()
        if row is None:
            return None, None

        media_service = MediaService(session)
        return row.username, media_service.resolve_public_url(row.avatar_url)


def _coerce_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    return None


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
            snapshots = manager.get_voice_snapshots_for_server(server_id)
            for snapshot in snapshots:
                await websocket.send_json(
                    {
                        "op": "DISPATCH",
                        "t": GatewayEventType.VOICE_PARTICIPANTS_SNAPSHOT.value,
                        "d": snapshot,
                    }
                )
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

    if event_type == ClientEventType.VOICE_JOIN.value:
        channel_id = data.get("channel_id")
        if not isinstance(channel_id, str):
            logger.info("voice.join rejected: missing channel_id user_id=%s", user_id)
            return

        channel = await _validate_voice_channel_access(channel_id, user_id)
        if channel is None:
            logger.info("voice.join rejected: access denied user_id=%s channel_id=%s", user_id, channel_id)
            await websocket.send_json(
                {
                    "op": "ERROR",
                    "t": "VOICE_JOIN_REJECTED",
                    "d": {"detail": "Cannot join voice channel"},
                }
            )
            return

        server_id = str(channel.server_id) if channel.server_id else None
        username, avatar_url = await _load_voice_user_profile(user_id)
        participants, joined_member, left_member = await manager.join_voice(
            channel_id=channel_id,
            server_id=server_id,
            user_id=user_id,
            username=username,
            avatar_url=avatar_url,
            websocket=websocket,
        )
        logger.info(
            "voice.join ok user_id=%s channel_id=%s server_id=%s participants=%d joined_new=%s",
            user_id,
            channel_id,
            server_id,
            len(participants),
            joined_member is not None,
        )

        if left_member is not None:
            left_payload = {
                "op": "DISPATCH",
                "t": GatewayEventType.VOICE_USER_LEFT.value,
                "d": left_member,
            }
            await manager.publish_voice(left_member["channel_id"], left_payload)
            left_server_id = left_member.get("server_id")
            if isinstance(left_server_id, str):
                await manager.publish_server(left_server_id, left_payload)

        if joined_member is not None:
            joined_payload = {
                "op": "DISPATCH",
                "t": GatewayEventType.VOICE_USER_JOINED.value,
                "d": joined_member,
            }
            await manager.publish_voice(channel_id, joined_payload, exclude={websocket})
            if isinstance(server_id, str):
                await manager.publish_server(server_id, joined_payload, exclude={websocket})

        await websocket.send_json(
            {
                "op": "DISPATCH",
                "t": GatewayEventType.VOICE_PARTICIPANTS_SNAPSHOT.value,
                "d": {
                    "channel_id": channel_id,
                    "server_id": server_id,
                    "participants": participants,
                },
            }
        )
        return

    if event_type == ClientEventType.VOICE_LEAVE.value:
        left_member = await manager.leave_voice(user_id=user_id, websocket=websocket)
        if left_member is None:
            logger.info("voice.leave ignored: no active membership user_id=%s", user_id)
            return

        logger.info(
            "voice.leave ok user_id=%s channel_id=%s server_id=%s",
            user_id,
            left_member["channel_id"],
            left_member.get("server_id"),
        )
        left_payload = {
            "op": "DISPATCH",
            "t": GatewayEventType.VOICE_USER_LEFT.value,
            "d": left_member,
        }
        await manager.publish_voice(left_member["channel_id"], left_payload)
        left_server_id = left_member.get("server_id")
        if isinstance(left_server_id, str):
            await manager.publish_server(left_server_id, left_payload)

        await websocket.send_json(
            {
                "op": "DISPATCH",
                "t": GatewayEventType.VOICE_LEAVE.value,
                "d": {
                    "channel_id": left_member["channel_id"],
                    "server_id": left_member.get("server_id"),
                    "user_id": user_id,
                },
            }
        )
        return

    if event_type == ClientEventType.VOICE_SIGNAL.value:
        member = manager.get_joined_voice_member(websocket, user_id)
        if member is None:
            logger.info("voice.signal ignored: sender not joined user_id=%s", user_id)
            return

        channel_id = data.get("channel_id")
        signal_type = data.get("signal_type")
        signal_payload = data.get("payload")
        if not isinstance(channel_id, str) or channel_id != member.get("channel_id"):
            logger.info(
                "voice.signal ignored: invalid channel sender=%s provided_channel=%s joined_channel=%s",
                user_id,
                channel_id,
                member.get("channel_id"),
            )
            return
        if signal_type not in {"offer", "answer", "ice-candidate"}:
            logger.info("voice.signal ignored: invalid type sender=%s type=%s", user_id, signal_type)
            return
        if not isinstance(signal_payload, dict):
            logger.info("voice.signal ignored: payload is not object sender=%s type=%s", user_id, signal_type)
            return

        target_user_id = data.get("target_user_id")
        logger.info(
            "voice.signal relay sender=%s target=%s channel_id=%s type=%s",
            user_id,
            target_user_id if isinstance(target_user_id, str) else "broadcast",
            channel_id,
            signal_type,
        )
        await manager.publish_voice(
            channel_id,
            {
                "op": "DISPATCH",
                "t": GatewayEventType.VOICE_SIGNAL.value,
                "d": {
                    "channel_id": channel_id,
                    "server_id": member.get("server_id"),
                    "user_id": user_id,
                    "target_user_id": target_user_id if isinstance(target_user_id, str) else None,
                    "signal_type": signal_type,
                    "payload": signal_payload,
                },
            },
            exclude={websocket},
        )
        return

    if event_type == ClientEventType.VOICE_STATE_UPDATE.value:
        muted = _coerce_bool(data.get("muted"))
        deafened = _coerce_bool(data.get("deafened"))
        screen_sharing = _coerce_bool(data.get("screen_sharing"))
        if muted is None and deafened is None and screen_sharing is None:
            return

        member = await manager.update_voice_state(
            user_id=user_id,
            websocket=websocket,
            muted=muted,
            deafened=deafened,
            screen_sharing=screen_sharing,
        )
        if member is None:
            return

        state_payload = {
            "op": "DISPATCH",
            "t": GatewayEventType.VOICE_STATE_UPDATE.value,
            "d": member,
        }
        await manager.publish_voice(member["channel_id"], state_payload)
        member_server_id = member.get("server_id")
        if isinstance(member_server_id, str):
            await manager.publish_server(member_server_id, state_payload)
        return

    await websocket.send_json(
        {
            "op": "ERROR",
            "t": "UNKNOWN_EVENT",
            "d": {"detail": f"Unsupported event: {event_type}"},
        }
    )
