from __future__ import annotations

import hashlib
import random
import secrets
from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from jose import JWTError
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.friend import AuditLog, RefreshToken
from app.models.user import User
from app.schemas.auth import AuthUser, TokenPair
from app.utils.jwt_utils import create_access_token, create_refresh_token, decode_token
from app.utils.password import hash_password, verify_password


class AuthService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def _audit(
        self,
        action: str,
        user_id: UUID | None,
        ip: str | None,
        metadata: dict[str, object] | None = None,
    ) -> None:
        event = AuditLog(user_id=user_id, action=action, ip_inet=ip, metadata_json=metadata or {})
        self.session.add(event)
        await self.session.flush()

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _token_pair(access_token: str, access_exp: datetime) -> TokenPair:
        return TokenPair(access_token=access_token, expires_at=access_exp)

    async def _issue_session(self, user: User, device_info: str | None) -> tuple[TokenPair, str, datetime]:
        access_token, access_exp = create_access_token(str(user.id), extra_claims={"username": user.username})
        refresh_token, refresh_exp = create_refresh_token(str(user.id))
        refresh_entity = RefreshToken(
            user_id=user.id,
            token_hash=self._hash_token(refresh_token),
            expires_at=refresh_exp,
            device_info=device_info,
        )
        self.session.add(refresh_entity)
        return self._token_pair(access_token, access_exp), refresh_token, refresh_exp

    async def register(
        self,
        username: str,
        email: str,
        password: str,
        public_key: str | None,
        ip: str | None,
    ) -> tuple[AuthUser, TokenPair, str, datetime]:
        discriminator = f"{random.randint(0, 9999):04d}"
        user = User(
            username=username,
            discriminator=discriminator,
            email=email,
            password_hash=hash_password(password),
            public_key=public_key,
        )
        self.session.add(user)

        try:
            await self.session.flush()
        except IntegrityError as exc:
            await self.session.rollback()
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username or email already exists") from exc

        token_pair, refresh_token, refresh_exp = await self._issue_session(user, None)

        await self._audit("auth.register", user.id, ip)
        await self.session.commit()

        auth_user = AuthUser(
            id=user.id,
            username=user.username,
            discriminator=user.discriminator,
            email=user.email,
            public_key=user.public_key,
        )
        return auth_user, token_pair, refresh_token, refresh_exp

    async def login(
        self,
        login_value: str,
        password: str,
        ip: str | None,
        device_info: str | None,
    ) -> tuple[AuthUser, TokenPair, str, datetime]:
        stmt = select(User).where(or_(User.email == login_value, User.username == login_value))
        user = (await self.session.execute(stmt)).scalar_one_or_none()

        if user is None or not verify_password(password, user.password_hash):
            await self._audit("auth.login_failed", user.id if user else None, ip, {"login": login_value})
            await self.session.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

        token_pair, refresh_token, refresh_exp = await self._issue_session(user, device_info)

        await self._audit("auth.login", user.id, ip)
        await self.session.commit()

        auth_user = AuthUser(
            id=user.id,
            username=user.username,
            discriminator=user.discriminator,
            email=user.email,
            public_key=user.public_key,
        )
        return auth_user, token_pair, refresh_token, refresh_exp

    async def oauth_login(
        self,
        username: str,
        email: str,
        ip: str | None,
        device_info: str | None,
    ) -> tuple[AuthUser, TokenPair, str, datetime]:
        user = (await self.session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            candidate = username[:32] if username else f"oauth_{secrets.token_hex(4)}"
            discriminator = f"{random.randint(0, 9999):04d}"
            user = User(
                username=candidate,
                discriminator=discriminator,
                email=email,
                password_hash=hash_password(secrets.token_urlsafe(32)),
                is_verified=True,
            )
            self.session.add(user)
            try:
                await self.session.flush()
            except IntegrityError as exc:
                await self.session.rollback()
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="OAuth account collision") from exc

        token_pair, refresh_token, refresh_exp = await self._issue_session(user, device_info)
        await self._audit("auth.oauth_login", user.id, ip, {"email": email})
        await self.session.commit()

        auth_user = AuthUser(
            id=user.id,
            username=user.username,
            discriminator=user.discriminator,
            email=user.email,
            public_key=user.public_key,
        )
        return auth_user, token_pair, refresh_token, refresh_exp

    async def refresh(self, token: str, ip: str | None) -> tuple[TokenPair, str, datetime]:
        try:
            payload = decode_token(token, expected_type="refresh")
        except JWTError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token") from exc

        sub = payload.get("sub")
        if not isinstance(sub, str):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token payload")

        hashed = self._hash_token(token)
        stmt = select(RefreshToken).where(RefreshToken.token_hash == hashed)
        current = (await self.session.execute(stmt)).scalar_one_or_none()

        now = datetime.now(UTC)
        if current is None or current.revoked_at is not None or current.expires_at < now:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token revoked or expired")

        current.revoked_at = now

        access_token, access_exp = create_access_token(sub)
        new_refresh_token, refresh_exp = create_refresh_token(sub)
        replacement = RefreshToken(
            user_id=UUID(sub),
            token_hash=self._hash_token(new_refresh_token),
            expires_at=refresh_exp,
            device_info=current.device_info,
        )
        self.session.add(replacement)

        await self._audit("auth.refresh", UUID(sub), ip)
        await self.session.commit()
        return self._token_pair(access_token, access_exp), new_refresh_token, refresh_exp

    async def logout(self, refresh_token: str | None, user_id: UUID | None, ip: str | None) -> None:
        if refresh_token:
            hashed = self._hash_token(refresh_token)
            stmt = select(RefreshToken).where(RefreshToken.token_hash == hashed)
            token = (await self.session.execute(stmt)).scalar_one_or_none()
            if token and token.revoked_at is None:
                token.revoked_at = datetime.now(UTC)
        await self._audit("auth.logout", user_id, ip)
        await self.session.commit()

