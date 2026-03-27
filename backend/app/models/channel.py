from __future__ import annotations

import enum
import uuid

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ChannelType(str, enum.Enum):
    text = "text"
    voice = "voice"
    announcement = "announcement"
    forum = "forum"
    dm = "dm"
    group_dm = "group_dm"


class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("servers.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    type: Mapped[ChannelType] = mapped_column(Enum(ChannelType, name="channel_type_enum"), default=ChannelType.text, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    topic: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_nsfw: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    slowmode_delay: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("channels.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    server = relationship("Server", back_populates="channels")
    messages = relationship("Message", back_populates="channel", cascade="all,delete")
    parent = relationship("Channel", remote_side="Channel.id", backref="children")
