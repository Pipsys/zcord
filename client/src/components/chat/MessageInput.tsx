import { useEffect, useMemo, useRef, useState } from "react";

import { EmojiPicker } from "@/components/chat/EmojiPicker";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/i18n/provider";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface MessageInputProps {
  channelName: string;
  onSubmit: (content: string, files: File[], onProgress?: (payload: AttachmentUploadProgressPayload) => void) => Promise<void>;
  onTyping?: () => void;
  typingText?: string | null;
  onFilesRejected?: (rejected: File[]) => void;
  replyingTo?: { id: string; author: string; preview: string } | null;
  editingMessage?: { id: string; preview: string } | null;
  onCancelReply?: () => void;
  onCancelEdit?: () => void;
  draftPreset?: { key: string; text: string; mode?: "replace" | "append" } | null;
}

const toFileKey = (file: Pick<File, "name" | "size" | "lastModified">): string => `${file.name}:${file.size}:${file.lastModified}`;

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const MessageInput = ({
  channelName,
  onSubmit,
  onTyping,
  typingText,
  onFilesRejected,
  replyingTo,
  editingMessage,
  onCancelReply,
  onCancelEdit,
  draftPreset,
}: MessageInputProps) => {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progressByFile, setProgressByFile] = useState<Record<string, AttachmentUploadProgressPayload>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingEmitRef = useRef(0);
  const lastDraftPresetKeyRef = useRef<string | null>(null);
  const remaining = 4000 - content.length;

  const uploadStatusLabels = useMemo(
    () => ({
      queued: t("message.upload_status_queued"),
      uploading: t("message.upload_status_uploading"),
      done: t("message.upload_status_done"),
      error: t("message.upload_status_error"),
    }),
    [t],
  );

  const appendFiles = (picked: FileList | null) => {
    if (!picked || picked.length === 0) {
      return;
    }

    const incoming = Array.from(picked);
    const rejected = incoming.filter((file) => file.size > MAX_UPLOAD_BYTES);
    if (rejected.length > 0) {
      onFilesRejected?.(rejected);
    }

    const accepted = incoming.filter((file) => file.size <= MAX_UPLOAD_BYTES);
    if (accepted.length === 0) {
      return;
    }

    setFiles((current) => {
      const existing = new Set(current.map((file) => toFileKey(file)));
      const next = [...current];
      for (const file of accepted) {
        const key = toFileKey(file);
        if (!existing.has(key)) {
          next.push(file);
          existing.add(key);
        }
      }
      return next;
    });
  };

  const emitTyping = () => {
    if (!onTyping) {
      return;
    }
    const now = Date.now();
    if (now - lastTypingEmitRef.current < 1_600) {
      return;
    }
    lastTypingEmitRef.current = now;
    onTyping();
  };

  useEffect(() => {
    if (!draftPreset || !draftPreset.key || draftPreset.key === lastDraftPresetKeyRef.current) {
      return;
    }
    lastDraftPresetKeyRef.current = draftPreset.key;
    setContent((current) => {
      if (draftPreset.mode === "append") {
        if (!current.trim()) {
          return draftPreset.text.slice(0, 4000);
        }
        return `${current}\n${draftPreset.text}`.slice(0, 4000);
      }
      return draftPreset.text.slice(0, 4000);
    });
  }, [draftPreset]);

  const submit = async () => {
    const trimmed = content.trim();
    if (isSubmitting || (!trimmed && files.length === 0) || remaining < 0) {
      return;
    }

    setIsSubmitting(true);
    setProgressByFile({});

    try {
      await onSubmit(trimmed, files, (entry) => {
        setProgressByFile((current) => ({ ...current, [entry.fileKey]: entry }));
      });
      setContent("");
      setFiles([]);
      setProgressByFile({});
    } finally {
      setIsSubmitting(false);
      setIsDragging(false);
    }
  };

  return (
    <div className="message-input-shell border-t border-black/35 bg-paw-bg-secondary px-3 pb-3 pt-2">
      {editingMessage ? (
        <div className="message-input-meta mb-2 flex items-center justify-between gap-3 rounded-lg bg-[#171a20] px-3 py-2">
          <div className="min-w-0">
            <p className="typo-meta font-semibold text-paw-text-secondary">{t("message.editing_label")}</p>
            <p className="typo-meta truncate">{editingMessage.preview}</p>
          </div>
          <button
            type="button"
            className="message-input-meta-btn rounded-md bg-[#22262e] px-2 py-1 text-xs font-semibold leading-4 text-paw-text-secondary transition-colors hover:bg-[#282d36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35"
            onClick={onCancelEdit}
          >
            {t("message.cancel")}
          </button>
        </div>
      ) : null}

      {!editingMessage && replyingTo ? (
        <div className="message-input-meta mb-2 flex items-center justify-between gap-3 rounded-lg bg-[#171a20] px-3 py-2">
          <div className="min-w-0">
            <p className="typo-meta font-semibold text-paw-text-secondary">
              {t("message.replying_to")} {replyingTo.author}
            </p>
            <p className="typo-meta truncate">{replyingTo.preview}</p>
          </div>
          <button
            type="button"
            className="message-input-meta-btn rounded-md bg-[#22262e] px-2 py-1 text-xs font-semibold leading-4 text-paw-text-secondary transition-colors hover:bg-[#282d36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35"
            onClick={onCancelReply}
          >
            {t("message.cancel")}
          </button>
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="mb-2 space-y-1.5">
          {files.map((file, index) => {
            const key = toFileKey(file);
            const upload = progressByFile[key];
            const progress = upload?.progress ?? 0;
            const statusLabel = upload ? uploadStatusLabels[upload.status] : null;
            return (
              <div key={`${key}-${index}`} className="message-input-file-row rounded-md border border-white/10 bg-[#0f1116] px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="typo-meta truncate font-medium text-paw-text-secondary">{file.name}</p>
                    <p className="typo-meta">{formatFileSize(file.size)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {statusLabel ? <span className="typo-meta text-paw-text-muted">{statusLabel}</span> : null}
                    <button
                      type="button"
                      disabled={isSubmitting}
                      className="rounded text-paw-text-muted transition-colors hover:text-paw-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => setFiles((current) => current.filter((item) => toFileKey(item) !== key))}
                    >
                      x
                    </button>
                  </div>
                </div>
                {upload ? (
                  <div className="message-input-file-progress-track mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="message-input-file-progress-fill h-full rounded-full bg-paw-accent transition-all duration-200" style={{ width: `${Math.max(2, Math.min(100, progress))}%` }} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="message-input-typing typo-meta mb-1 min-h-4 px-1 text-paw-text-muted">{typingText ?? ""}</div>

      <div
        className={`message-input-row flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors ${
          isDragging ? "border-paw-accent/50 bg-[#171a20]" : "border-white/10 bg-[#0f1116]"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          if (!isDragging) {
            setIsDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
            return;
          }
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          appendFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            appendFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />

        <button
          className="message-input-attach inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#171a20] text-lg leading-none text-paw-text-muted transition-colors hover:bg-[#1f2229] hover:text-paw-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35"
          type="button"
          title={t("message.input_attach")}
          onClick={() => fileInputRef.current?.click()}
        >
          +
        </button>

        <input
          value={content}
          onChange={(event) => {
            const nextValue = event.target.value.slice(0, 4000);
            setContent(nextValue);
            if (nextValue.trim().length > 0) {
              emitTyping();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={editingMessage ? t("message.editing_placeholder") : t("message.input_placeholder", { channel: channelName })}
          className="typo-message h-9 min-w-0 flex-1 bg-transparent px-1 text-paw-text-secondary placeholder:text-paw-text-muted focus:outline-none"
        />

        <EmojiPicker
          onPick={(emoji) => {
            setContent((value) => `${value}${emoji}`);
            emitTyping();
          }}
        />

        <Button
          onClick={() => void submit()}
          disabled={isSubmitting || (content.trim().length === 0 && files.length === 0) || remaining < 0}
          className="shrink-0 px-3 py-1.5 text-xs"
        >
          {isSubmitting ? t("message.upload_status_uploading") : editingMessage ? t("message.edit_action_save") : t("message.input_send")}
        </Button>

        <span className="typo-meta hidden w-16 shrink-0 text-right tabular-nums text-paw-text-muted xl:block">{remaining}/4000</span>
      </div>
    </div>
  );
};

