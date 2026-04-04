from __future__ import annotations

import secrets
from datetime import UTC, datetime
from urllib.parse import urlsplit

from app.config import get_settings
from app.models.server_invite import ServerInvite

settings = get_settings()

_DEFAULT_INVITE_ORIGIN = "https://pawcord.ru"


def generate_invite_code(length: int = 24) -> str:
    # URL-safe opaque token: no server ids in links and high entropy.
    token = secrets.token_urlsafe(length)
    return token[: max(16, min(64, len(token)))]


def build_public_invite_url(code: str) -> str:
    raw_origin = (settings.invite_public_origin or "").strip() or _DEFAULT_INVITE_ORIGIN
    try:
        origin = urlsplit(raw_origin)
        if not origin.scheme or not origin.netloc:
            raise ValueError("Invalid invite_public_origin")
        normalized = f"{origin.scheme}://{origin.netloc}"
    except Exception:
        normalized = _DEFAULT_INVITE_ORIGIN
    return f"{normalized}/invite/{code}"


def utcnow() -> datetime:
    return datetime.now(UTC)


def invite_is_active(invite: ServerInvite, now: datetime | None = None) -> bool:
    moment = now or utcnow()
    if invite.revoked_at is not None:
        return False
    if invite.expires_at is not None and invite.expires_at <= moment:
        return False
    if invite.max_uses is not None and invite.uses_count >= invite.max_uses:
        return False
    return True
