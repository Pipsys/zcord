from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Channel
from app.models.message import Message, Reaction
from app.utils.validators import sanitize_message_content, validate_message_length


class MessageService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_message(
        self,
        channel_id: UUID,
        author_id: UUID,
        content: str,
        nonce: str | None,
        message_type,
        reference_id: UUID | None,
    ) -> Message:
        channel = await self.session.get(Channel, channel_id)
        if channel is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Channel not found")

        safe_content = validate_message_length(sanitize_message_content(content))
        message = Message(
            channel_id=channel_id,
            author_id=author_id,
            content=safe_content,
            nonce=nonce,
            type=message_type,
            reference_id=reference_id,
            search_vector=func.to_tsvector("simple", safe_content),
        )
        self.session.add(message)
        await self.session.commit()
        await self.session.refresh(message)
        return message

    async def update_message(self, message_id: UUID, author_id: UUID, content: str) -> Message:
        message = await self.session.get(Message, message_id)
        if message is None or message.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        if message.author_id != author_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot edit another user's message")

        safe_content = validate_message_length(sanitize_message_content(content))
        message.content = safe_content
        message.search_vector = func.to_tsvector("simple", safe_content)
        message.edited_at = datetime.now(UTC)
        await self.session.commit()
        await self.session.refresh(message)
        return message

    async def delete_message(self, message_id: UUID, actor_id: UUID) -> None:
        message = await self.session.get(Message, message_id)
        if message is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
        if message.author_id != actor_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete another user's message")

        await self.session.delete(message)
        await self.session.commit()

    async def list_messages(
        self,
        channel_id: UUID,
        before_id: UUID | None = None,
        after_id: UUID | None = None,
        limit: int = 50,
    ) -> list[Message]:
        limit = max(1, min(limit, 50))

        stmt = (
            select(Message)
            .where(Message.channel_id == channel_id, Message.deleted_at.is_(None))
            .order_by(desc(Message.created_at))
            .limit(limit)
        )

        if before_id:
            before = await self.session.get(Message, before_id)
            if before:
                stmt = stmt.where(Message.created_at < before.created_at)

        if after_id:
            after = await self.session.get(Message, after_id)
            if after:
                stmt = stmt.where(Message.created_at > after.created_at)

        rows = await self.session.execute(stmt)
        return list(rows.scalars().all())

    async def search_messages(self, channel_id: UUID, query: str, limit: int = 25) -> list[Message]:
        search_query = func.websearch_to_tsquery("simple", query)
        stmt = (
            select(Message)
            .where(
                Message.channel_id == channel_id,
                Message.deleted_at.is_(None),
                Message.search_vector.op("@@")(search_query),
            )
            .order_by(desc(Message.created_at))
            .limit(max(1, min(limit, 50)))
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def add_reaction(self, message_id: UUID, user_id: UUID, emoji: str) -> Reaction:
        message = await self.session.get(Message, message_id)
        if message is None or message.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

        reaction = Reaction(message_id=message_id, user_id=user_id, emoji=emoji)
        self.session.add(reaction)
        await self.session.commit()
        return reaction

    async def remove_reaction(self, message_id: UUID, user_id: UUID, emoji: str) -> None:
        stmt = select(Reaction).where(
            Reaction.message_id == message_id,
            Reaction.user_id == user_id,
            Reaction.emoji == emoji,
        )
        reaction = (await self.session.execute(stmt)).scalar_one_or_none()
        if reaction is None:
            return
        await self.session.delete(reaction)
        await self.session.commit()
