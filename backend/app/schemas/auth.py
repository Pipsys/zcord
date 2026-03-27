from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import EmailStr, Field

from app.schemas.base import StrictSchema


class RegisterRequest(StrictSchema):
    username: str = Field(min_length=2, max_length=32)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    public_key: str | None = Field(default=None, min_length=44, max_length=200)


class LoginRequest(StrictSchema):
    login: str = Field(min_length=2, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class TokenPair(StrictSchema):
    access_token: str
    token_type: str = "Bearer"
    expires_at: datetime


class AuthUser(StrictSchema):
    id: UUID
    username: str
    discriminator: str
    email: EmailStr
    public_key: str | None


class AuthResponse(StrictSchema):
    token: TokenPair
    user: AuthUser
    refresh_token: str | None = None


class RefreshResponse(StrictSchema):
    token: TokenPair
    refresh_token: str | None = None


class RefreshRequest(StrictSchema):
    refresh_token: str


class LogoutResponse(StrictSchema):
    ok: bool = True


class OAuthUrlResponse(StrictSchema):
    provider: str
    auth_url: str
    state: str
