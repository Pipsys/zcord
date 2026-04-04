from __future__ import annotations

import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Server(Base):
    __tablename__ = "servers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    icon_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    banner_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    region: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_nsfw: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    max_members: Mapped[int] = mapped_column(Integer, default=500000, nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    owner = relationship("User", back_populates="owned_servers")
    channels = relationship("Channel", back_populates="server", cascade="all,delete")
    roles = relationship("Role", back_populates="server", cascade="all,delete")
    members = relationship("Member", back_populates="server", cascade="all,delete")
    invites = relationship("ServerInvite", back_populates="server", cascade="all,delete")
