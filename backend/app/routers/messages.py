from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.attachment import Attachment
from app.models.channel import Channel
from app.models.message import Message, MessageReceipt
from app.models.user import User
from app.routers.deps import get_current_user
from app.schemas.message import MessageAttachmentRead, MessageCreate, MessageDeleteRead, MessageRead, MessageUpdate, ReactionPayload
from app.services.channel_access_service import assert_user_can_access_channel
from app.services.media_service import MediaService
from app.services.message_service import MessageService
from app.websocket.events import GatewayEventType
from app.websocket.manager import manager

router = APIRouter(prefix="/messages", tags=["messages"])


async def _load_receipts(
    session: AsyncSession,
    message_ids: list[UUID],
) -> dict[UUID, dict[str, list[UUID] | datetime | None]]:
    if not message_ids:
        return {}

    rows = (
        await session.execute(
            select(MessageReceipt).where(MessageReceipt.message_id.in_(message_ids))
        )
    ).scalars().all()

    receipt_map: dict[UUID, dict[str, list[UUID] | datetime | None]] = {}
    for receipt in rows:
        message_map = receipt_map.setdefault(
            receipt.message_id,
            {"delivered_by": [], "read_by": [], "delivered_at": None, "read_at": None},
        )
        delivered_by = message_map["delivered_by"]
        if isinstance(delivered_by, list):
            delivered_by.append(receipt.user_id)
        delivered_at = message_map.get("delivered_at")
        if isinstance(delivered_at, datetime):
            if receipt.delivered_at < delivered_at:
                message_map["delivered_at"] = receipt.delivered_at
        else:
            message_map["delivered_at"] = receipt.delivered_at
        if receipt.read_at is not None:
            read_by = message_map["read_by"]
            if isinstance(read_by, list):
                read_by.append(receipt.user_id)
            read_at = message_map.get("read_at")
            if isinstance(read_at, datetime):
                if receipt.read_at < read_at:
                    message_map["read_at"] = receipt.read_at
            else:
                message_map["read_at"] = receipt.read_at
    return receipt_map


async def _mark_messages_read(
    session: AsyncSession,
    channel: Channel,
    messages: list[Message],
    reader_id: UUID,
) -> None:
    target_ids = [message.id for message in messages if message.author_id != reader_id]
    if not target_ids:
        return

    existing_rows = (
        await session.execute(
            select(MessageReceipt).where(
                MessageReceipt.user_id == reader_id,
                MessageReceipt.message_id.in_(target_ids),
            )
        )
    ).scalars().all()
    existing_by_message_id = {receipt.message_id: receipt for receipt in existing_rows}

    changed: list[tuple[UUID, datetime]] = []
    for message_id in target_ids:
        now = datetime.now(UTC)
        receipt = existing_by_message_id.get(message_id)
        if receipt is None:
            session.add(
                MessageReceipt(
                    message_id=message_id,
                    user_id=reader_id,
                    delivered_at=now,
                    read_at=now,
                )
            )
            changed.append((message_id, now))
            continue

        if receipt.read_at is None:
            if receipt.delivered_at is None:
                receipt.delivered_at = now
            receipt.read_at = now
            changed.append((message_id, now))

    if not changed:
        return

    await session.commit()

    for message_id, read_at in changed:
        event = {
            "op": "DISPATCH",
            "t": GatewayEventType.MESSAGE_READ.value,
            "d": {
                "channel_id": str(channel.id),
                "message_id": str(message_id),
                "user_id": str(reader_id),
                "at": read_at.isoformat(),
            },
        }
        if channel.server_id:
            await manager.publish_server(str(channel.server_id), event)
        else:
            await manager.publish_dm(str(channel.id), event)


async def _load_author_usernames(
    session: AsyncSession,
    author_ids: list[UUID],
) -> dict[UUID, dict[str, str | None]]:
    unique_author_ids = list(set(author_ids))
    if not unique_author_ids:
        return {}

    rows = await session.execute(
        select(User.id, User.username, User.avatar_url).where(User.id.in_(unique_author_ids))
    )
    media_service = MediaService(session)
    return {
        user_id: {
            "username": username,
            "avatar_url": media_service.resolve_public_url(avatar_url),
        }
        for user_id, username, avatar_url in rows.all()
    }


async def _load_attachments(
    session: AsyncSession,
    message_ids: list[UUID],
) -> dict[UUID, list[MessageAttachmentRead]]:
    unique_message_ids = list(set(message_ids))
    if not unique_message_ids:
        return {}

    rows = (
        await session.execute(
            select(Attachment).where(Attachment.message_id.in_(unique_message_ids))
        )
    ).scalars().all()

    media_service = MediaService(session)
    attachment_map: dict[UUID, list[MessageAttachmentRead]] = {}
    for attachment in rows:
        payload = MessageAttachmentRead(
            id=attachment.id,
            filename=attachment.filename,
            content_type=attachment.content_type,
            size_bytes=attachment.size_bytes,
            width=attachment.width,
            height=attachment.height,
            download_url=media_service.presigned_download_url(attachment.minio_key),
        )
        attachment_map.setdefault(attachment.message_id, []).append(payload)
    return attachment_map


def _serialize_message(
    message: Message,
    server_id: UUID | None,
    receipt_map: dict[UUID, dict[str, list[UUID] | datetime | None]],
    author_usernames: dict[UUID, dict[str, str | None]],
    attachment_map: dict[UUID, list[MessageAttachmentRead]],
) -> MessageRead:
    delivered_by = receipt_map.get(message.id, {}).get("delivered_by")
    read_by = receipt_map.get(message.id, {}).get("read_by")
    delivered_at = receipt_map.get(message.id, {}).get("delivered_at")
    read_at = receipt_map.get(message.id, {}).get("read_at")
    author_profile = author_usernames.get(message.author_id) or {}
    payload = {
        "id": message.id,
        "channel_id": message.channel_id,
        "server_id": server_id,
        "author_id": message.author_id,
        "author_username": author_profile.get("username"),
        "author_avatar_url": author_profile.get("avatar_url"),
        "content": message.content,
        "nonce": message.nonce,
        "type": message.type,
        "reference_id": message.reference_id,
        "edited_at": message.edited_at,
        "deleted_at": message.deleted_at,
        "created_at": message.created_at,
        "delivered_by": delivered_by if isinstance(delivered_by, list) else [],
        "read_by": read_by if isinstance(read_by, list) else [],
        "delivered_at": delivered_at if isinstance(delivered_at, datetime) else None,
        "read_at": read_at if isinstance(read_at, datetime) else None,
        "attachments": attachment_map.get(message.id, []),
    }
    return MessageRead.model_validate(payload)


@router.get("", response_model=list[MessageRead])
async def list_messages(
    channel_id: UUID,
    before_id: UUID | None = Query(default=None),
    after_id: UUID | None = Query(default=None),
    mark_read: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await assert_user_can_access_channel(session, channel, current_user.id)

    service = MessageService(session)
    messages = await service.list_messages(channel_id, before_id=before_id, after_id=after_id, limit=limit)
    if mark_read:
        await _mark_messages_read(session, channel, messages, current_user.id)
    receipt_map = await _load_receipts(session, [message.id for message in messages])
    author_usernames = await _load_author_usernames(session, [message.author_id for message in messages])
    attachment_map = await _load_attachments(session, [message.id for message in messages])
    return [_serialize_message(message, channel.server_id, receipt_map, author_usernames, attachment_map) for message in messages]


@router.get("/search", response_model=list[MessageRead])
async def search_messages(
    channel_id: UUID,
    query: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=25, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    channel = await session.get(Channel, channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await assert_user_can_access_channel(session, channel, current_user.id)

    service = MessageService(session)
    messages = await service.search_messages(channel_id=channel_id, query=query, limit=limit)
    receipt_map = await _load_receipts(session, [message.id for message in messages])
    author_usernames = await _load_author_usernames(session, [message.author_id for message in messages])
    attachment_map = await _load_attachments(session, [message.id for message in messages])
    return [_serialize_message(message, channel.server_id, receipt_map, author_usernames, attachment_map) for message in messages]


@router.post("", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
async def create_message(
    payload: MessageCreate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    channel = await session.get(Channel, payload.channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await assert_user_can_access_channel(session, channel, current_user.id)

    service = MessageService(session)
    message = await service.create_message(
        channel_id=payload.channel_id,
        author_id=current_user.id,
        content=payload.content,
        nonce=payload.nonce,
        message_type=payload.type,
        reference_id=payload.reference_id,
    )

    receipt_map = await _load_receipts(session, [message.id])
    serialized = _serialize_message(
        message,
        channel.server_id,
        receipt_map,
        {
            current_user.id: {
                "username": current_user.username,
                "avatar_url": MediaService(session).resolve_public_url(current_user.avatar_url),
            }
        },
        {},
    )
    message_payload = serialized.model_dump(mode="json")

    event = {
        "op": "DISPATCH",
        "t": GatewayEventType.MESSAGE_CREATE.value,
        "d": message_payload,
    }
    if channel and channel.server_id:
        await manager.publish_server(str(channel.server_id), event)
    else:
        await manager.publish_dm(str(payload.channel_id), event)

    return serialized


@router.patch("/{message_id}", response_model=MessageRead)
async def update_message(
    message_id: UUID,
    payload: MessageUpdate,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    existing = await session.get(Message, message_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    channel = await session.get(Channel, existing.channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await assert_user_can_access_channel(session, channel, current_user.id)

    service = MessageService(session)
    message = await service.update_message(message_id=message_id, author_id=current_user.id, content=payload.content)
    receipt_map = await _load_receipts(session, [message.id])
    author_usernames = await _load_author_usernames(session, [message.author_id])
    attachment_map = await _load_attachments(session, [message.id])
    serialized = _serialize_message(message, channel.server_id, receipt_map, author_usernames, attachment_map)
    event = {
        "op": "DISPATCH",
        "t": GatewayEventType.MESSAGE_UPDATE.value,
        "d": serialized.model_dump(mode="json"),
    }
    if channel.server_id:
        await manager.publish_server(str(channel.server_id), event)
    else:
        await manager.publish_dm(str(channel.id), event)
    return serialized


@router.delete("/{message_id}", response_model=MessageDeleteRead)
async def delete_message(
    message_id: UUID,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    existing = await session.get(Message, message_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    channel = await session.get(Channel, existing.channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await assert_user_can_access_channel(session, channel, current_user.id)

    service = MessageService(session)
    deleted_at = datetime.now(UTC)
    await service.delete_message(message_id=message_id, actor_id=current_user.id)

    payload = {
        "message_id": message_id,
        "channel_id": channel.id,
        "server_id": channel.server_id,
        "deleted_at": deleted_at,
    }
    event = {
        "op": "DISPATCH",
        "t": GatewayEventType.MESSAGE_DELETE.value,
        "d": {
            "message_id": str(message_id),
            "channel_id": str(channel.id),
            "server_id": str(channel.server_id) if channel.server_id else None,
            "deleted_at": deleted_at.isoformat(),
        },
    }
    if channel.server_id:
        await manager.publish_server(str(channel.server_id), event)
    else:
        await manager.publish_dm(str(channel.id), event)
    return MessageDeleteRead.model_validate(payload)


@router.post("/{message_id}/reactions", status_code=status.HTTP_201_CREATED)
async def add_reaction(
    message_id: UUID,
    payload: ReactionPayload,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    existing = await session.get(Message, message_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    channel = await session.get(Channel, existing.channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await assert_user_can_access_channel(session, channel, current_user.id)

    service = MessageService(session)
    reaction = await service.add_reaction(message_id, current_user.id, payload.emoji)
    return {"message_id": str(reaction.message_id), "emoji": reaction.emoji, "user_id": str(reaction.user_id)}


@router.delete("/{message_id}/reactions/{emoji}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_reaction(
    message_id: UUID,
    emoji: str,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    existing = await session.get(Message, message_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    channel = await session.get(Channel, existing.channel_id)
    if channel is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")
    await assert_user_can_access_channel(session, channel, current_user.id)

    service = MessageService(session)
    await service.remove_reaction(message_id, current_user.id, emoji)
    return None
