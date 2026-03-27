"""initial pawcord schema

Revision ID: 20260325_000001
Revises:
Create Date: 2026-03-25 23:40:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260325_000001"
down_revision = None
branch_labels = None
depends_on = None


user_status_enum = postgresql.ENUM("online", "idle", "dnd", "invisible", name="user_status_enum")
channel_type_enum = postgresql.ENUM("text", "voice", "announcement", "forum", "dm", "group_dm", name="channel_type_enum")
message_type_enum = postgresql.ENUM("default", "system", "reply", "thread_starter", name="message_type_enum")
friend_status_enum = postgresql.ENUM("pending", "accepted", "blocked", name="friend_status_enum")


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("username", sa.String(length=32), nullable=False),
        sa.Column("discriminator", sa.String(length=4), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("banner_url", sa.Text(), nullable=True),
        sa.Column("bio", sa.String(length=190), nullable=True),
        sa.Column("status", user_status_enum, nullable=False, server_default="online"),
        sa.Column("custom_status", sa.String(length=128), nullable=True),
        sa.Column("public_key", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("is_bot", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "servers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("icon_url", sa.Text(), nullable=True),
        sa.Column("banner_url", sa.Text(), nullable=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("region", sa.String(length=64), nullable=True),
        sa.Column("is_nsfw", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("max_members", sa.Integer(), nullable=False, server_default="500000"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_servers_owner_id", "servers", ["owner_id"], unique=False)

    op.create_table(
        "channels",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("type", channel_type_enum, nullable=False, server_default="text"),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("topic", sa.String(length=1024), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_nsfw", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("slowmode_delay", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["channels.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_channels_server_id", "channels", ["server_id"], unique=False)
    op.create_index("ix_channels_parent_id", "channels", ["parent_id"], unique=False)

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("nonce", sa.Text(), nullable=True),
        sa.Column("type", message_type_enum, nullable=False, server_default="default"),
        sa.Column("reference_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("search_vector", postgresql.TSVECTOR(), nullable=True),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reference_id"], ["messages.id"], ondelete="SET NULL"),
        sa.CheckConstraint("char_length(content) <= 4000", name="ck_message_content_len"),
    )
    op.create_index("ix_messages_channel_id", "messages", ["channel_id"], unique=False)
    op.create_index("ix_messages_author_id", "messages", ["author_id"], unique=False)
    op.create_index("ix_messages_reference_id", "messages", ["reference_id"], unique=False)
    op.create_index(
        "ix_messages_channel_created_desc",
        "messages",
        [sa.text("channel_id"), sa.text("created_at DESC")],
        unique=False,
    )
    op.create_index(
        "ix_messages_search_vector",
        "messages",
        ["search_vector"],
        unique=False,
        postgresql_using="gin",
    )

    op.create_table(
        "attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("minio_key", sa.Text(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_attachments_message_id", "attachments", ["message_id"], unique=False)

    op.create_table(
        "reactions",
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("emoji", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("message_id", "user_id", "emoji"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_reactions_user_id", "reactions", ["user_id"], unique=False)

    op.create_table(
        "roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("color", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("permissions", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_mentionable", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_hoisted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_roles_server_id", "roles", ["server_id"], unique=False)

    op.create_table(
        "members",
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("nickname", sa.String(length=32), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("server_id", "user_id"),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_members_server_id", "members", ["server_id"], unique=False)
    op.create_index("ix_members_user_id", "members", ["user_id"], unique=False)

    op.create_table(
        "member_roles",
        sa.Column("member_server_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("member_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("member_server_id", "member_user_id", "role_id", name="pk_member_roles"),
        sa.ForeignKeyConstraint(["member_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["member_server_id", "member_user_id"],
            ["members.server_id", "members.user_id"],
            ondelete="CASCADE",
            name="fk_member_roles_member",
        ),
    )
    op.create_index("ix_member_roles_role_id", "member_roles", ["role_id"], unique=False)
    op.create_index("ix_member_roles_member_user_id", "member_roles", ["member_user_id"], unique=False)
    op.create_index("ix_member_roles_member_server_id", "member_roles", ["member_server_id"], unique=False)

    op.create_table(
        "friends",
        sa.Column("requester_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("addressee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", friend_status_enum, nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("requester_id", "addressee_id"),
        sa.ForeignKeyConstraint(["requester_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["addressee_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_friends_requester_id", "friends", ["requester_id"], unique=False)
    op.create_index("ix_friends_addressee_id", "friends", ["addressee_id"], unique=False)

    op.create_table(
        "refresh_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("device_info", sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token_hash", name="uq_refresh_tokens_token_hash"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"], unique=False)

    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(length=128), nullable=False),
        sa.Column("ip_inet", postgresql.INET(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_audit_logs_user_id", table_name="audit_logs")
    op.drop_table("audit_logs")

    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")

    op.drop_index("ix_friends_addressee_id", table_name="friends")
    op.drop_index("ix_friends_requester_id", table_name="friends")
    op.drop_table("friends")

    op.drop_index("ix_member_roles_member_server_id", table_name="member_roles")
    op.drop_index("ix_member_roles_member_user_id", table_name="member_roles")
    op.drop_index("ix_member_roles_role_id", table_name="member_roles")
    op.drop_table("member_roles")

    op.drop_index("ix_members_user_id", table_name="members")
    op.drop_index("ix_members_server_id", table_name="members")
    op.drop_table("members")

    op.drop_index("ix_roles_server_id", table_name="roles")
    op.drop_table("roles")

    op.drop_index("ix_reactions_user_id", table_name="reactions")
    op.drop_table("reactions")

    op.drop_index("ix_attachments_message_id", table_name="attachments")
    op.drop_table("attachments")

    op.drop_index("ix_messages_search_vector", table_name="messages")
    op.drop_index("ix_messages_channel_created_desc", table_name="messages")
    op.drop_index("ix_messages_reference_id", table_name="messages")
    op.drop_index("ix_messages_author_id", table_name="messages")
    op.drop_index("ix_messages_channel_id", table_name="messages")
    op.drop_table("messages")

    op.drop_index("ix_channels_parent_id", table_name="channels")
    op.drop_index("ix_channels_server_id", table_name="channels")
    op.drop_table("channels")

    op.drop_index("ix_servers_owner_id", table_name="servers")
    op.drop_table("servers")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")

    friend_status_enum.drop(op.get_bind(), checkfirst=True)
    message_type_enum.drop(op.get_bind(), checkfirst=True)
    channel_type_enum.drop(op.get_bind(), checkfirst=True)
    user_status_enum.drop(op.get_bind(), checkfirst=True)




