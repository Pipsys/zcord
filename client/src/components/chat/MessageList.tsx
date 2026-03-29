import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { MessageItem } from "@/components/chat/MessageItem";
import { useI18n } from "@/i18n/provider";
import type { Message } from "@/types";

interface MessageListProps {
  channelName: string;
  messages: Message[];
  onReply?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  onForward?: (message: Message) => void;
}

const shouldShowAuthor = (current: Message, previous: Message | undefined): boolean => {
  if (!previous) {
    return true;
  }

  const currentTime = new Date(current.created_at).getTime();
  const previousTime = new Date(previous.created_at).getTime();
  const lessThanFiveMinutes = currentTime - previousTime < 5 * 60 * 1000;

  return !(previous.author_id === current.author_id && lessThanFiveMinutes);
};

export const MessageList = ({ channelName, messages, onReply, onEdit, onDelete, onForward }: MessageListProps) => {
  const { t } = useI18n();
  const parentRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const previousCountRef = useRef(0);

  const indexedMessages = useMemo(
    () =>
      [...messages].sort(
        (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
      ),
    [messages],
  );
  const messageById = useMemo(
    () =>
      indexedMessages.reduce<Record<string, Message>>((acc, message) => {
        acc[message.id] = message;
        return acc;
      }, {}),
    [indexedMessages],
  );

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) {
      return;
    }

    const handleScroll = () => {
      const distanceToBottom = parent.scrollHeight - parent.scrollTop - parent.clientHeight;
      shouldStickToBottomRef.current = distanceToBottom < 140;
    };

    handleScroll();
    parent.addEventListener("scroll", handleScroll);
    return () => parent.removeEventListener("scroll", handleScroll);
  }, []);

  useLayoutEffect(() => {
    const parent = parentRef.current;
    if (!parent) {
      return;
    }

    const grew = indexedMessages.length > previousCountRef.current;
    previousCountRef.current = indexedMessages.length;
    if (!grew || !shouldStickToBottomRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      parent.scrollTop = parent.scrollHeight;
    });
  }, [indexedMessages.length]);

  if (indexedMessages.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-paw-bg-primary px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-paw-text-secondary">{t("message.empty_title")}</p>
          <p className="mt-2 text-sm text-paw-text-muted">{t("server.empty_chat_subtitle", { channel: channelName })}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto overflow-x-hidden">
      <div className="flex flex-col pb-3 pt-1">
        {indexedMessages.map((message, index) => {
          const previous = indexedMessages[index - 1];
          const referencedMessage = message.reference_id ? messageById[message.reference_id] ?? null : null;
          return (
            <MessageItem
              key={message.id}
              message={message}
              referencedMessage={referencedMessage}
              showAuthor={shouldShowAuthor(message, previous)}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
              onForward={onForward}
            />
          );
        })}
      </div>
    </div>
  );
};
