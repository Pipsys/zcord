"""add server invite links

Revision ID: 20260404_000002
Revises: 20260326_000002
Create Date: 2026-04-04 16:20:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260404_000002"
down_revision = "20260326_000002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "server_invites",
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_uses", sa.Integer(), nullable=True),
        sa.Column("uses_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("code"),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_server_invites_server_id", "server_invites", ["server_id"], unique=False)
    op.create_index("ix_server_invites_created_by", "server_invites", ["created_by"], unique=False)
    op.create_index("ix_server_invites_expires_at", "server_invites", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_server_invites_expires_at", table_name="server_invites")
    op.drop_index("ix_server_invites_created_by", table_name="server_invites")
    op.drop_index("ix_server_invites_server_id", table_name="server_invites")
    op.drop_table("server_invites")
