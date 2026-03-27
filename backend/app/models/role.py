from __future__ import annotations

import uuid

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("servers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    permissions: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_mentionable: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_hoisted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    server = relationship("Server", back_populates="roles")
    member_roles = relationship("MemberRole", back_populates="role", cascade="all,delete")
