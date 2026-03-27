"""add message receipts

Revision ID: 20260326_000002
Revises: 20260325_000001
Create Date: 2026-03-26 03:45:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260326_000002"
down_revision = "20260325_000001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "message_receipts",
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("message_id", "user_id"),
    )
    op.create_index("ix_message_receipts_user_id", "message_receipts", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_message_receipts_user_id", table_name="message_receipts")
    op.drop_table("message_receipts")
