from __future__ import annotations

import enum
import uuid

from sqlalchemy import Boolean, DateTime, Enum, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class UserStatus(str, enum.Enum):
    online = "online"
    idle = "idle"
    dnd = "dnd"
    invisible = "invisible"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    discriminator: Mapped[str] = mapped_column(String(4), default="0001")
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    banner_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    bio: Mapped[str | None] = mapped_column(String(190), nullable=True)
    status: Mapped[UserStatus] = mapped_column(Enum(UserStatus, name="user_status_enum"), default=UserStatus.online)
    custom_status: Mapped[str | None] = mapped_column(String(128), nullable=True)
    public_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    owned_servers = relationship("Server", back_populates="owner", cascade="all,delete")
    messages = relationship("Message", back_populates="author")
    memberships = relationship("Member", back_populates="user", cascade="all,delete")
    roles = relationship("MemberRole", back_populates="user", cascade="all,delete")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all,delete")
    audit_logs = relationship("AuditLog", back_populates="user")
