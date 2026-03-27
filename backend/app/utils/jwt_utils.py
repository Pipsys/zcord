from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from jose import JWTError, jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.config import get_settings

settings = get_settings()
_DEV_PRIVATE_KEY: str | None = None
_DEV_PUBLIC_KEY: str | None = None


def _read_key(path: Path) -> str:
    if not path.exists():
        if settings.env == "production":
            raise FileNotFoundError(f"JWT key file not found: {path}")
        global _DEV_PRIVATE_KEY, _DEV_PUBLIC_KEY
        if _DEV_PRIVATE_KEY is None or _DEV_PUBLIC_KEY is None:
            generated = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            _DEV_PRIVATE_KEY = generated.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            ).decode("utf-8")
            _DEV_PUBLIC_KEY = generated.public_key().public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            ).decode("utf-8")
        if "private" in path.name:
            return _DEV_PRIVATE_KEY
        return _DEV_PUBLIC_KEY
    return path.read_text(encoding="utf-8")


def get_private_key() -> str:
    if settings.jwt_private_key is not None:
        return settings.jwt_private_key.get_secret_value()
    return _read_key(settings.jwt_private_key_path)


def get_public_key() -> str:
    if settings.jwt_public_key is not None:
        return settings.jwt_public_key.get_secret_value()
    return _read_key(settings.jwt_public_key_path)


def create_access_token(subject: str, extra_claims: dict[str, object] | None = None) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    expires_at = now + timedelta(minutes=settings.access_token_ttl_minutes)
    payload: dict[str, object] = {
        "sub": subject,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": str(uuid.uuid4()),
    }
    if extra_claims:
        payload.update(extra_claims)
    token = jwt.encode(payload, get_private_key(), algorithm=settings.jwt_algorithm)
    return token, expires_at


def create_refresh_token(subject: str, extra_claims: dict[str, object] | None = None) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    expires_at = now + timedelta(days=settings.refresh_token_ttl_days)
    payload: dict[str, object] = {
        "sub": subject,
        "type": "refresh",
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": str(uuid.uuid4()),
    }
    if extra_claims:
        payload.update(extra_claims)
    token = jwt.encode(payload, get_private_key(), algorithm=settings.jwt_algorithm)
    return token, expires_at


def decode_token(token: str, expected_type: str | None = None) -> dict[str, object]:
    payload = jwt.decode(token, get_public_key(), algorithms=[settings.jwt_algorithm])
    if expected_type and payload.get("type") != expected_type:
        raise JWTError("Invalid token type")
    return payload
