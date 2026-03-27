from __future__ import annotations

import enum
from datetime import datetime
from typing import Any

from pydantic import Field

from app.schemas.base import StrictSchema


class GatewayEventType(str, enum.Enum):
    READY = "READY"
    MESSAGE_CREATE = "MESSAGE_CREATE"
    MESSAGE_DELIVERED = "MESSAGE_DELIVERED"
    MESSAGE_READ = "MESSAGE_READ"
    MESSAGE_UPDATE = "MESSAGE_UPDATE"
    MESSAGE_DELETE = "MESSAGE_DELETE"
    REACTION_ADD = "REACTION_ADD"
    REACTION_REMOVE = "REACTION_REMOVE"
    CHANNEL_CREATE = "CHANNEL_CREATE"
    CHANNEL_UPDATE = "CHANNEL_UPDATE"
    CHANNEL_DELETE = "CHANNEL_DELETE"
    MEMBER_JOIN = "MEMBER_JOIN"
    MEMBER_LEAVE = "MEMBER_LEAVE"
    MEMBER_UPDATE = "MEMBER_UPDATE"
    PRESENCE_UPDATE = "PRESENCE_UPDATE"
    TYPING_START = "TYPING_START"
    VOICE_JOIN = "VOICE_JOIN"
    VOICE_LEAVE = "VOICE_LEAVE"
    VOICE_PARTICIPANTS_SNAPSHOT = "VOICE_PARTICIPANTS_SNAPSHOT"
    VOICE_USER_JOINED = "VOICE_USER_JOINED"
    VOICE_USER_LEFT = "VOICE_USER_LEFT"
    VOICE_SIGNAL = "VOICE_SIGNAL"
    VOICE_STATE_UPDATE = "VOICE_STATE_UPDATE"
    SERVER_CREATE = "SERVER_CREATE"
    SERVER_UPDATE = "SERVER_UPDATE"
    SERVER_DELETE = "SERVER_DELETE"
    HEARTBEAT_ACK = "HEARTBEAT_ACK"


class ClientEventType(str, enum.Enum):
    IDENTIFY = "IDENTIFY"
    HEARTBEAT = "HEARTBEAT"
    SUBSCRIBE_SERVER = "SUBSCRIBE_SERVER"
    TYPING = "TYPING"
    MESSAGE_DELIVERED_ACK = "MESSAGE_DELIVERED_ACK"
    MESSAGE_READ_ACK = "MESSAGE_READ_ACK"
    VOICE_JOIN = "VOICE_JOIN"
    VOICE_LEAVE = "VOICE_LEAVE"
    VOICE_SIGNAL = "VOICE_SIGNAL"
    VOICE_STATE_UPDATE = "VOICE_STATE_UPDATE"


class EventEnvelope(StrictSchema):
    op: str
    t: str
    d: dict[str, Any]


class TypingPayload(StrictSchema):
    channel_id: str
    user_id: str
    expires_at: datetime


class VoiceSignalPayload(StrictSchema):
    channel_id: str
    user_id: str
    target_user_id: str | None = None
    signal_type: str = Field(pattern="^(offer|answer|ice-candidate)$")
    payload: dict[str, Any]
