import { type MouseEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { enUS, ru } from "date-fns/locale";
import { createPortal } from "react-dom";

import { Avatar } from "@/components/ui/Avatar";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import { useMessageStore } from "@/store/messageStore";
import type { Message } from "@/types";

interface MessageItemProps {
  message: Message;
  referencedMessage?: Message | null;
  showAuthor: boolean;
  onReply?: (message: Message) => void;
  onEdit?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  onForward?: (message: Message) => void;
}

const parseCodeBlock = (content: string): { normal: string; code: string | null } => {
  const match = content.match(/```([\s\S]+?)```/);
  if (!match) {
    return { normal: content, code: null };
  }

  return {
    normal: content.replace(match[0], "").trim(),
    code: match[1].trim(),
  };
};

const prettyAuthor = (message: Message, currentUserId: string | null, currentUsername: string | null): string => {
  if (currentUserId && message.author_id === currentUserId) {
    return currentUsername ?? message.author_username ?? "you";
  }
  const authorUsername = message.author_username?.trim();
  if (authorUsername) {
    return authorUsername;
  }
  return `user-${message.author_id.slice(0, 6)}`;
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HTTP_LINK_RE = /https?:\/\/[^\s<]+/gi;

const splitUrlAndTrailingPunctuation = (raw: string): { url: string; trailing: string } => {
  let index = raw.length;
  while (index > 0 && /[.,!?;:]/.test(raw[index - 1] ?? "")) {
    index -= 1;
  }
  return {
    url: raw.slice(0, index),
    trailing: raw.slice(index),
  };
};

const openExternalLink = (event: MouseEvent<HTMLAnchorElement>, href: string): void => {
  if (!/^https?:\/\//i.test(href)) {
    return;
  }

  event.preventDefault();
  const openViaBridge = window.pawcord?.shell?.openExternal;
  if (openViaBridge) {
    void openViaBridge(href);
    return;
  }

  window.open(href, "_blank", "noopener,noreferrer");
};

const linkifyText = (value: string): ReactNode[] => {
  if (!value) {
    return [value];
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = 0;

  value.replace(HTTP_LINK_RE, (rawMatch, offset: number) => {
    if (offset > cursor) {
      nodes.push(value.slice(cursor, offset));
    }

    const { url, trailing } = splitUrlAndTrailingPunctuation(rawMatch);
    let isValidUrl = false;
    try {
      const parsed = new URL(url);
      isValidUrl = parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      isValidUrl = false;
    }

    if (isValidUrl) {
      nodes.push(
        <a
          key={`msg-link-${offset}-${matchIndex}`}
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => openExternalLink(event, url)}
          className="underline decoration-paw-accent/70 underline-offset-2 transition-colors hover:text-paw-text-primary"
        >
          {url}
        </a>,
      );
      if (trailing.length > 0) {
        nodes.push(trailing);
      }
    } else {
      nodes.push(rawMatch);
    }

    cursor = offset + rawMatch.length;
    matchIndex += 1;
    return rawMatch;
  });

  if (cursor < value.length) {
    nodes.push(value.slice(cursor));
  }

  return nodes;
};

const asDownloadHref = (value: string): string => {
  try {
    const parsed = new URL(value, window.location.href);
    if (!parsed.pathname.includes("/api/v1/media/attachments/")) {
      return value;
    }
    parsed.searchParams.set("download", "1");
    return parsed.toString();
  } catch {
    return value;
  }
};

const hasMentionForCurrentUser = (content: string, userId: string | null, username: string | null): boolean => {
  if (!content || (!userId && !username)) {
    return false;
  }
  if (userId && content.includes(`<@${userId}>`)) {
    return true;
  }
  if (!username) {
    return false;
  }
  const matcher = new RegExp(`(^|\\W)@${escapeRegExp(username)}(?=$|\\W)`, "i");
  return matcher.test(content);
};

const ActionButton = ({
  title,
  onClick,
  children,
  danger = false,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    className={`chat-message-action-btn ${danger ? "chat-message-action-btn--danger" : ""}`}
    onClick={onClick}
  >
    {children}
  </button>
);

export const MessageItem = ({ message, referencedMessage, showAuthor, onReply, onEdit, onDelete, onForward }: MessageItemProps) => {
  const { locale, t } = useI18n();
  const currentUser = useAuthStore((state) => state.user);
  const receipt = useMessageStore((state) => state.receiptsByMessage[message.id]);
  const [previewImage, setPreviewImage] = useState<{ url: string; filename: string } | null>(null);

  const parsed = parseCodeBlock(message.content);
  const attachments = message.attachments ?? [];
  const isOwn = currentUser?.id === message.author_id;
  const currentUserId = currentUser?.id ?? null;
  const popupRoot = typeof document !== "undefined" ? document.body : null;

  const authorName = prettyAuthor(message, currentUserId, currentUser?.username ?? null);
  const messageDateTime = format(new Date(message.created_at), "dd.MM.yyyy HH:mm", {
    locale: locale === "ru" ? ru : enUS,
  });
  const messageTime = format(new Date(message.created_at), "HH:mm", {
    locale: locale === "ru" ? ru : enUS,
  });

  const deliveredToOthers = (receipt?.deliveredBy ?? []).some((userId) => userId !== currentUserId);
  const readByOthers = (receipt?.readBy ?? []).some((userId) => userId !== currentUserId);
  const statusIcon = readByOthers ? "\u2713\u2713" : deliveredToOthers ? "\u2713" : "";
  const statusTitle = readByOthers ? t("message.status_read") : deliveredToOthers ? t("message.status_delivered") : t("message.status_sent");
  const resolvedReadBy = receipt?.readBy ?? message.read_by;
  const hasReadState = Array.isArray(resolvedReadBy);
  const isUnreadForCurrentUser = Boolean(currentUserId) && !isOwn && hasReadState && !resolvedReadBy.includes(currentUserId);
  const isMentionedForCurrentUser = isUnreadForCurrentUser && hasMentionForCurrentUser(message.content, currentUserId, currentUser?.username ?? null);
  const rowStateClass = isMentionedForCurrentUser ? "chat-message-row--mention" : isUnreadForCurrentUser ? "chat-message-row--unread" : "";

  const referencedAuthor = useMemo(() => {
    if (!referencedMessage) {
      return "";
    }
    return prettyAuthor(referencedMessage, currentUserId, currentUser?.username ?? null);
  }, [currentUser?.username, currentUserId, referencedMessage]);
  const referencedPreview = referencedMessage?.content?.trim() || t("message.reply_missing");

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewImage(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewImage]);

  const avatarSrc = message.author_avatar_url ?? null;

  return (
    <>
      <article className={`chat-message-row group relative w-full px-2 py-0.5 ${rowStateClass}`}>
        <div className="flex">
          <div className="mr-3 w-10 shrink-0 pt-0.5">
            {showAuthor ? (
              <Avatar src={avatarSrc} label={authorName} size="md" />
            ) : (
              <span className="typo-meta invisible block px-1 pt-1 text-right group-hover:visible group-focus-within:visible">{messageTime}</span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            {showAuthor ? (
              <div className="flex items-center gap-2">
                <span className={`typo-body truncate font-semibold ${isOwn ? "text-paw-accentSecondary" : "text-paw-text-primary"}`}>{authorName}</span>
                <span className="typo-meta shrink-0">{messageDateTime}</span>
                {message.edited_at ? <span className="typo-meta shrink-0">({t("message.edited")})</span> : null}
                {isOwn && statusIcon ? (
                  <span title={statusTitle} className={`typo-meta shrink-0 font-semibold ${readByOthers ? "text-paw-accentSecondary" : "text-paw-text-muted"}`}>
                    {statusIcon}
                  </span>
                ) : null}
              </div>
            ) : null}

            {referencedMessage ? (
              <button
                type="button"
                className={`message-ref-card mt-1 block max-w-[680px] rounded-md border-l-2 border-paw-accent/60 bg-white/[0.02] px-2 py-1 text-left ${showAuthor ? "" : "mt-0.5"}`}
                onClick={() => onReply?.(referencedMessage)}
              >
                <p className="typo-meta truncate font-semibold text-paw-text-secondary">{referencedAuthor}</p>
                <p className="typo-meta truncate">{referencedPreview}</p>
              </button>
            ) : null}

            {parsed.normal ? (
              <p className={`typo-message whitespace-pre-wrap break-words text-paw-text-secondary ${showAuthor ? "mt-0.5" : ""}`}>
                {linkifyText(parsed.normal)}
              </p>
            ) : null}

            {parsed.code ? <pre className="message-code-block mt-1 overflow-auto rounded-lg bg-black/45 p-2.5 font-mono text-xs text-paw-text-primary">{parsed.code}</pre> : null}

            {attachments.length > 0 ? (
              <div className="mt-2 space-y-2">
                {attachments.map((attachment) => {
                  if (attachment.content_type.startsWith("image/")) {
                    const aspectRatio =
                      typeof attachment.width === "number" && typeof attachment.height === "number" && attachment.width > 0 && attachment.height > 0
                        ? `${attachment.width} / ${attachment.height}`
                        : undefined;

                    return (
                      <button
                        key={attachment.id}
                        type="button"
                        className="message-attachment-image-wrap block max-w-full cursor-zoom-in overflow-hidden rounded-xl bg-black/35 p-0"
                        style={{ width: "min(420px, 100%)" }}
                        onClick={() => setPreviewImage({ url: attachment.download_url, filename: attachment.filename })}
                        title={t("message.image_open")}
                      >
                        <img
                          src={attachment.download_url}
                          alt={attachment.filename}
                          loading="lazy"
                          style={aspectRatio ? { aspectRatio } : undefined}
                          className="block h-auto max-h-[320px] w-full max-w-full object-contain"
                        />
                      </button>
                    );
                  }

                  if (attachment.content_type.startsWith("video/")) {
                    return (
                      <video
                        key={attachment.id}
                        controls
                        preload="metadata"
                        className="message-attachment-video max-h-80 max-w-full rounded-xl bg-black/35"
                        style={{ width: "min(420px, 100%)" }}
                        src={attachment.download_url}
                      />
                    );
                  }

                  if (attachment.content_type.startsWith("audio/")) {
                    return <audio key={attachment.id} controls preload="metadata" className="w-full max-w-[420px]" src={attachment.download_url} />;
                  }

                  return (
                    <a
                      key={attachment.id}
                      href={asDownloadHref(attachment.download_url)}
                      download={attachment.filename}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => openExternalLink(event, asDownloadHref(attachment.download_url))}
                      className="message-attachment-file flex min-w-[220px] max-w-[420px] items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2 hover:bg-white/10"
                    >
                      <div className="min-w-0">
                        <p className="typo-body truncate font-medium text-paw-text-secondary">{attachment.filename}</p>
                        <p className="typo-meta">
                          {attachment.content_type} - {formatFileSize(attachment.size_bytes)}
                        </p>
                      </div>
                      <span className="typo-meta text-paw-text-muted">{"\u2197"}</span>
                    </a>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="chat-message-actions pointer-events-none absolute right-3 top-1 z-20 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="chat-message-action-toolbar pointer-events-auto">
            {onReply ? (
              <ActionButton title={t("message.action_reply")} onClick={() => onReply(message)}>
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                  <path d="M9 8 5 12l4 4" />
                  <path d="M5 12h8a6 6 0 0 1 6 6" />
                </svg>
              </ActionButton>
            ) : null}

            {onForward ? (
              <ActionButton title={t("message.action_forward")} onClick={() => onForward(message)}>
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                  <path d="M7 12h10" />
                  <path d="m13 8 4 4-4 4" />
                  <path d="M7 6h7" />
                </svg>
              </ActionButton>
            ) : null}

            {isOwn && onEdit ? (
              <ActionButton title={t("message.action_edit")} onClick={() => onEdit(message)}>
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                  <path d="m4 20 4.5-1 9.7-9.7a2 2 0 0 0 0-2.8l-.7-.7a2 2 0 0 0-2.8 0L5 15.5 4 20Z" />
                </svg>
              </ActionButton>
            ) : null}

            {isOwn && onDelete ? (
              <ActionButton title={t("message.action_delete")} onClick={() => onDelete(message)} danger>
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                  <path d="M5 7h14" />
                  <path d="M9 7V5h6v2" />
                  <path d="m8 7 1 12h6l1-12" />
                </svg>
              </ActionButton>
            ) : null}
          </div>
        </div>
      </article>

      {previewImage && popupRoot
        ? createPortal(
            <div className="message-preview-overlay fixed inset-0 z-[300] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm" onClick={() => setPreviewImage(null)}>
              <div
                className="message-preview-surface flex w-full max-w-5xl flex-col rounded-2xl bg-[#0a0d13] p-3 shadow-2xl shadow-black/70"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-medium text-paw-text-secondary">{previewImage.filename}</p>
                  <div className="flex items-center gap-2">
                    <a
                      href={asDownloadHref(previewImage.url)}
                      download={previewImage.filename}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => openExternalLink(event, asDownloadHref(previewImage.url))}
                      className="message-preview-btn inline-flex items-center rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-paw-text-secondary transition hover:bg-white/15"
                    >
                      {t("message.image_download")}
                    </a>
                    <button
                      type="button"
                      className="message-preview-btn inline-flex items-center rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-paw-text-secondary transition hover:bg-white/15"
                      onClick={() => setPreviewImage(null)}
                    >
                      {t("message.image_preview_close")}
                    </button>
                  </div>
                </div>

                <div className="message-preview-image-wrap min-h-0 max-h-[82vh] overflow-auto rounded-xl bg-black/35 p-2">
                  <img src={previewImage.url} alt={previewImage.filename} className="mx-auto block h-auto max-h-[78vh] w-auto max-w-full object-contain" />
                </div>
              </div>
            </div>,
            popupRoot,
          )
        : null}
    </>
  );
};


