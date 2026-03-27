from __future__ import annotations

import uuid

from sqlalchemy import DateTime, ForeignKey, ForeignKeyConstraint, PrimaryKeyConstraint, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Member(Base):
    __tablename__ = "members"

    server_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("servers.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    nickname: Mapped[str | None] = mapped_column(String(32), nullable=True)
    joined_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    server = relationship("Server", back_populates="members")
    user = relationship("User", back_populates="memberships")
    assigned_roles = relationship("MemberRole", back_populates="member", cascade="all,delete")


class MemberRole(Base):
    __tablename__ = "member_roles"
    __table_args__ = (
        PrimaryKeyConstraint("member_server_id", "member_user_id", "role_id", name="pk_member_roles"),
        ForeignKeyConstraint(
            ["member_server_id", "member_user_id"],
            ["members.server_id", "members.user_id"],
            ondelete="CASCADE",
            name="fk_member_roles_member",
        ),
    )

    member_server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    member_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("roles.id", ondelete="CASCADE"),
        nullable=False,
    )

    member = relationship("Member", back_populates="assigned_roles")
    role = relationship("Role", back_populates="member_roles")
    user = relationship("User", back_populates="roles")
