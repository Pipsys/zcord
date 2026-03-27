from __future__ import annotations

import enum
import uuid

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MessageType(str, enum.Enum):
    default = "default"
    system = "system"
    reply = "reply"
    thread_starter = "thread_starter"


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (CheckConstraint("char_length(content) <= 4000", name="ck_message_content_len"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("channels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    nonce: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[MessageType] = mapped_column(Enum(MessageType, name="message_type_enum"), default=MessageType.default, nullable=False)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    edited_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    search_vector: Mapped[str | None] = mapped_column(TSVECTOR, nullable=True)

    channel = relationship("Channel", back_populates="messages")
    author = relationship("User", back_populates="messages")
    reference = relationship("Message", remote_side="Message.id")
    attachments = relationship("Attachment", back_populates="message", cascade="all,delete")
    reactions = relationship("Reaction", back_populates="message", cascade="all,delete")
    receipts = relationship("MessageReceipt", back_populates="message", cascade="all,delete")


class Reaction(Base):
    __tablename__ = "reactions"

    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    emoji: Mapped[str] = mapped_column(String(64), primary_key=True)

    message = relationship("Message", back_populates="reactions")


class MessageReceipt(Base):
    __tablename__ = "message_receipts"

    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    delivered_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    read_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    message = relationship("Message", back_populates="receipts")
