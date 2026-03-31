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
  const sameDay = new Date(current.created_at).toDateString() === new Date(previous.created_at).toDateString();

  return !(previous.author_id === current.author_id && lessThanFiveMinutes && sameDay);
};

const isSameDay = (left: Message, right: Message): boolean =>
  new Date(left.created_at).toDateString() === new Date(right.created_at).toDateString();

const formatDayDividerLabel = (value: Date, locale: string): string => {
  const now = new Date();
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfValue = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const dayDiff = Math.round((startOfNow - startOfValue) / (24 * 60 * 60 * 1000));

  if (dayDiff === 0) {
    return locale === "ru" ? "Сегодня" : "Today";
  }
  if (dayDiff === 1) {
    return locale === "ru" ? "Вчера" : "Yesterday";
  }

  const resolvedLocale = locale === "ru" ? "ru-RU" : "en-US";
  return new Intl.DateTimeFormat(resolvedLocale, {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(value);
};

type MessageListEntry =
  | { type: "divider"; key: string; label: string }
  | { type: "message"; key: string; message: Message; previous: Message | undefined };

export const MessageList = ({ channelName, messages, onReply, onEdit, onDelete, onForward }: MessageListProps) => {
  const { t, locale } = useI18n();
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
  const listEntries = useMemo<MessageListEntry[]>(() => {
    const next: MessageListEntry[] = [];
    for (let index = 0; index < indexedMessages.length; index += 1) {
      const message = indexedMessages[index];
      const previous = indexedMessages[index - 1];
      if (!previous || !isSameDay(previous, message)) {
        next.push({
          type: "divider",
          key: `divider-${new Date(message.created_at).toDateString()}`,
          label: formatDayDividerLabel(new Date(message.created_at), locale),
        });
      }
      next.push({
        type: "message",
        key: message.id,
        message,
        previous,
      });
    }
    return next;
  }, [indexedMessages, locale]);

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
          <p className="typo-title-md text-paw-text-secondary">{t("message.empty_title")}</p>
          <p className="typo-body mt-2 text-paw-text-muted">{t("server.empty_chat_subtitle", { channel: channelName })}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto overflow-x-hidden">
      <div className="flex flex-col pb-3 pt-1">
        {listEntries.map((entry) => {
          if (entry.type === "divider") {
            return (
              <div key={entry.key} className="chat-date-divider ui-anim-fade-slide">
                <span className="chat-date-divider-line" />
                <span className="chat-date-divider-label">{entry.label}</span>
              </div>
            );
          }

          const referencedMessage = entry.message.reference_id ? messageById[entry.message.reference_id] ?? null : null;
          return (
            <MessageItem
              key={entry.key}
              message={entry.message}
              referencedMessage={referencedMessage}
              showAuthor={shouldShowAuthor(entry.message, entry.previous)}
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

