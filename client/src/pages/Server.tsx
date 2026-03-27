import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import {
  useChannelsQuery,
  useCreateChannelMutation,
  useCreateMessageMutation,
  useDeleteMessageMutation,
  useMessagesQuery,
  useServersQuery,
  useUpdateMessageMutation,
  useUploadAttachmentsMutation,
} from "@/api/queries";
import type { UploadProgressEvent } from "@/api/client";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ChannelList } from "@/components/layout/ChannelList";
import { MemberList } from "@/components/layout/MemberList";
import { Sidebar } from "@/components/layout/Sidebar";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useVoiceRoom } from "@/hooks/useVoiceRoom";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import { useChannelStore } from "@/store/channelStore";
import { useMessageStore } from "@/store/messageStore";
import { useServerStore } from "@/store/serverStore";
import { useUiStore } from "@/store/uiStore";
import type { Message } from "@/types";

const VoiceChannel = lazy(() => import("@/components/voice/VoiceChannel").then((module) => ({ default: module.VoiceChannel })));

const compactPreview = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "...";
  }
  return normalized.slice(0, 90);
};

const ServerPage = () => {
  const { t } = useI18n();
  const { serverId } = useParams();
  const socket = useWebSocket();
  const voiceRoom = useVoiceRoom(socket);
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const currentUsername = useAuthStore((state) => state.user?.username ?? null);

  const [replyTarget, setReplyTarget] = useState<{ id: string; author: string; preview: string } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; preview: string } | null>(null);
  const [draftPreset, setDraftPreset] = useState<{ key: string; text: string; mode?: "replace" | "append" } | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<Message | null>(null);
  const lastReadAckByChannelRef = useRef<Record<string, string>>({});

  const setServers = useServerStore((state) => state.setServers);
  const setActiveServer = useServerStore((state) => state.setActiveServer);
  const setChannels = useChannelStore((state) => state.setChannels);
  const setActiveChannel = useChannelStore((state) => state.setActiveChannel);
  const activeChannelId = useChannelStore((state) => state.activeChannelId);
  const storedChannels = useChannelStore((state) => state.channels);

  const messagesByChannel = useMessageStore((state) => state.byChannel);
  const setMessages = useMessageStore((state) => state.setMessages);
  const removeMessageFromStore = useMessageStore((state) => state.deleteMessage);
  const typingByChannel = useMessageStore((state) => state.typingByChannel);
  const pushToast = useUiStore((state) => state.pushToast);

  const { data: servers } = useServersQuery();
  const { data: channels } = useChannelsQuery(serverId ?? null);
  const activeChannel = useMemo(() => storedChannels.find((item) => item.id === activeChannelId) ?? null, [storedChannels, activeChannelId]);
  const activeChannelName = activeChannel?.name ?? "general";
  const currentServer = useMemo(() => servers?.find((item) => item.id === serverId) ?? null, [servers, serverId]);

  const textChannelId = activeChannel && activeChannel.type !== "voice" ? activeChannel.id : null;
  const { data: messages } = useMessagesQuery(textChannelId);
  const activeTextMessages = useMemo(() => (textChannelId ? messagesByChannel[textChannelId] ?? [] : []), [messagesByChannel, textChannelId]);
  const activeTypingText = useMemo(() => {
    if (!textChannelId) {
      return null;
    }
    const typingMap = typingByChannel[textChannelId] ?? {};
    const typingUsers = Object.keys(typingMap).filter((userId) => userId !== currentUserId);
    if (typingUsers.length === 0) {
      return null;
    }
    if (typingUsers.length === 1) {
      return t("message.typing_user", { user: `user-${typingUsers[0].slice(0, 6)}` });
    }
    return t("message.typing_many", { count: typingUsers.length });
  }, [currentUserId, t, textChannelId, typingByChannel]);

  useEffect(() => {
    setReplyTarget(null);
    setEditingMessage(null);
  }, [textChannelId]);

  const createMessage = useCreateMessageMutation();
  const uploadAttachments = useUploadAttachmentsMutation();
  const updateMessage = useUpdateMessageMutation();
  const deleteMessage = useDeleteMessageMutation();
  const createChannel = useCreateChannelMutation();

  useEffect(() => {
    if (servers) {
      setServers(servers);
    }
  }, [servers, setServers]);

  useEffect(() => {
    if (serverId) {
      setActiveServer(serverId);
    }
  }, [serverId, setActiveServer]);

  useEffect(() => {
    if (!serverId || !socket) {
      return;
    }

    const subscribe = () => {
      socket.send(JSON.stringify({ t: "SUBSCRIBE_SERVER", d: { server_id: serverId } }));
    };

    if (socket.readyState === WebSocket.OPEN) {
      subscribe();
      return;
    }

    socket.addEventListener("open", subscribe, { once: true });
    return () => socket.removeEventListener("open", subscribe);
  }, [serverId, socket]);

  useEffect(() => {
    if (channels) {
      setChannels(channels);
      if (!activeChannelId && channels.length > 0) {
        const preferred = channels.find((item) => item.type !== "voice") ?? channels[0];
        setActiveChannel(preferred.id);
      }
    }
  }, [activeChannelId, channels, setActiveChannel, setChannels]);

  useEffect(() => {
    if (textChannelId && messages) {
      setMessages(textChannelId, messages);
    }
  }, [messages, setMessages, textChannelId]);

  useEffect(() => {
    if (!socket || !textChannelId) {
      return;
    }
    const lastForeignMessage = [...activeTextMessages].reverse().find((item) => item.author_id !== currentUserId);
    if (!lastForeignMessage) {
      return;
    }
    if (lastReadAckByChannelRef.current[textChannelId] === lastForeignMessage.id) {
      return;
    }
    lastReadAckByChannelRef.current[textChannelId] = lastForeignMessage.id;

    const sendReadAck = () => {
      socket.send(
        JSON.stringify({
          t: "MESSAGE_READ_ACK",
          d: {
            channel_id: textChannelId,
            server_id: serverId,
            message_id: lastForeignMessage.id,
          },
        }),
      );
    };

    if (socket.readyState === WebSocket.OPEN) {
      sendReadAck();
      return;
    }

    socket.addEventListener("open", sendReadAck, { once: true });
    return () => socket.removeEventListener("open", sendReadAck);
  }, [activeTextMessages, currentUserId, serverId, socket, textChannelId]);

  const buildNextChannelName = (type: "text" | "voice") => {
    const prefix = type === "text" ? "text" : "voice";
    const names = new Set(
      storedChannels
        .filter((channel) => channel.type === type)
        .map((channel) => channel.name.toLowerCase()),
    );

    let index = 1;
    let candidate = `${prefix}-${index}`;
    while (names.has(candidate)) {
      index += 1;
      candidate = `${prefix}-${index}`;
    }
    return candidate;
  };

  const createServerChannel = async (type: "text" | "voice", preferredName?: string) => {
    if (!serverId) {
      return null;
    }

    const name = preferredName ?? buildNextChannelName(type);
    const position = storedChannels.filter((channel) => channel.type === type).length;

    const channel = await createChannel.mutateAsync({
      server_id: serverId,
      type,
      name,
      topic: null,
      position,
      is_nsfw: false,
      slowmode_delay: 0,
      parent_id: null,
    });

    setActiveChannel(channel.id);
    return channel;
  };

  const resolveMessageAuthor = (message: Message): string => {
    if (message.author_id === currentUserId) {
      return currentUsername ?? message.author_username ?? `user-${message.author_id.slice(0, 6)}`;
    }
    const normalized = message.author_username?.trim();
    return normalized && normalized.length > 0 ? normalized : `user-${message.author_id.slice(0, 6)}`;
  };

  const submitMessage = async (content: string, files: File[], onProgress?: (entry: UploadProgressEvent) => void) => {
    if (!textChannelId || (!content.trim() && files.length === 0)) {
      return;
    }

    try {
      if (editingMessage) {
        await updateMessage.mutateAsync({
          messageId: editingMessage.id,
          content,
        });
        setEditingMessage(null);
        return;
      }

      const created = await createMessage.mutateAsync({
        channel_id: textChannelId,
        content,
        nonce: null,
        type: replyTarget ? "reply" : "default",
        reference_id: replyTarget?.id ?? null,
      });

      if (files.length > 0) {
        await uploadAttachments.mutateAsync({
          messageId: created.id,
          channelId: textChannelId,
          files,
          onProgress,
        });
      }

      setReplyTarget(null);
    } catch (error) {
      const title = editingMessage ? t("message.edit_failed") : t("message.send_failed");
      pushToast(title, error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const createDefaultChannel = async () => {
    try {
      const channel = await createServerChannel("text", "general");
      if (!channel) {
        return;
      }
      pushToast(t("server.channel_created"), `#${channel.name}`);
    } catch (error) {
      pushToast(t("server.channel_create_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const handleCreateTextChannel = async () => {
    try {
      const channel = await createServerChannel("text");
      if (!channel) {
        return;
      }
      pushToast(t("channels.text_channel_created"), `#${channel.name}`);
    } catch (error) {
      pushToast(t("server.channel_create_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const handleCreateVoiceChannel = async () => {
    try {
      const channel = await createServerChannel("voice");
      if (!channel) {
        return;
      }
      pushToast(t("channels.voice_channel_created"), channel.name);
    } catch (error) {
      pushToast(t("server.channel_create_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const copyInvite = async () => {
    if (!serverId) {
      return;
    }

    const inviteText = t("server.invite_payload", {
      name: currentServer?.name ?? "Server",
      id: serverId,
    });

    try {
      const copiedByBridge = await window.pawcord.clipboard.writeText(inviteText);
      if (!copiedByBridge) {
        await navigator.clipboard.writeText(inviteText);
      }
      pushToast(t("server.invite_copied"), t("server.invite_copied_desc"));
    } catch {
      try {
        await navigator.clipboard.writeText(inviteText);
        pushToast(t("server.invite_copied"), t("server.invite_copied_desc"));
      } catch {
        pushToast(t("server.invite_copy_failed"), serverId);
      }
    }
  };

  const handleReplyToMessage = (message: Message) => {
    setEditingMessage(null);
    setReplyTarget({
      id: message.id,
      author: resolveMessageAuthor(message),
      preview: compactPreview(message.content),
    });
  };

  const handleEditMessage = (message: Message) => {
    setReplyTarget(null);
    setEditingMessage({
      id: message.id,
      preview: compactPreview(message.content),
    });
    setDraftPreset({
      key: `edit-${message.id}-${Date.now()}`,
      text: message.content,
      mode: "replace",
    });
  };

  const handleForwardMessage = (message: Message) => {
    const body = message.content.trim().length > 0 ? compactPreview(message.content) : t("message.attachment_alt");
    const forwardText = t("message.forward_prefix", {
      author: resolveMessageAuthor(message),
      content: body,
    });
    setDraftPreset({
      key: `forward-${message.id}-${Date.now()}`,
      text: forwardText,
      mode: "append",
    });
    pushToast(t("message.forward_ready"), "");
  };

  const handleDeleteMessage = async (message: Message) => {
    setPendingDeleteMessage(message);
  };

  const confirmDeleteMessage = async () => {
    if (!pendingDeleteMessage) {
      return;
    }
    try {
      await deleteMessage.mutateAsync(pendingDeleteMessage.id);
      removeMessageFromStore(pendingDeleteMessage.channel_id, pendingDeleteMessage.id);
      if (editingMessage?.id === pendingDeleteMessage.id) {
        setEditingMessage(null);
      }
      if (replyTarget?.id === pendingDeleteMessage.id) {
        setReplyTarget(null);
      }
      setPendingDeleteMessage(null);
      pushToast(t("message.delete_success"), "");
    } catch (error) {
      pushToast(t("message.delete_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-paw-bg-primary">
      <Sidebar />

      <ChannelList
        connectedVoiceChannelId={voiceRoom.connectedChannelId}
        onJoinVoice={(channelId) => {
          setActiveChannel(channelId);
          void voiceRoom.join(channelId, serverId ?? null);
        }}
        onLeaveVoice={() => void voiceRoom.leave()}
        onCreateTextChannel={() => void handleCreateTextChannel()}
        onCreateVoiceChannel={() => void handleCreateVoiceChannel()}
        isCreatingChannel={createChannel.isPending}
      />

      <section className="flex min-w-0 flex-1 flex-col bg-paw-bg-primary">
        <header className="flex h-12 items-center justify-between border-b border-white/10 bg-black/20 px-4">
          <div className="flex items-center gap-2">
            <span className="text-lg text-paw-text-muted">#</span>
            <h3 className="text-[15px] font-semibold text-paw-text-secondary">{activeChannel?.name ?? t("server.no_channel_selected")}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button className="bg-black/25 px-3 py-1 text-xs text-paw-text-secondary shadow-none hover:bg-black/35" onClick={() => void copyInvite()}>
              {t("server.invite_button")}
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {!activeChannel ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <p className="font-display text-lg text-paw-text-primary">{t("server.no_channel_selected")}</p>
                <p className="mt-2 text-sm text-paw-text-secondary">{t("server.no_channel_hint")}</p>
                {(channels?.length ?? 0) === 0 ? (
                  <Button className="mt-4" onClick={() => void createDefaultChannel()}>
                    {t("server.create_default_channel")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {activeChannel?.type !== "voice" && textChannelId ? (
            <MessageList
              channelName={activeChannelName}
              messages={activeTextMessages}
              onReply={handleReplyToMessage}
              onEdit={handleEditMessage}
              onDelete={(message) => void handleDeleteMessage(message)}
              onForward={handleForwardMessage}
            />
          ) : null}

          {activeChannel?.type === "voice" ? (
            <Suspense fallback={<div className="p-4 text-sm text-paw-text-muted">{t("server.loading_voice")}</div>}>
              <VoiceChannel
                channelId={activeChannel.id}
                channelName={activeChannelName}
                connected={voiceRoom.connectedChannelId === activeChannel.id}
                participants={voiceRoom.connectedChannelId === activeChannel.id ? voiceRoom.participants : []}
                remoteStreams={voiceRoom.remoteStreams}
                muted={voiceRoom.muted}
                deafened={voiceRoom.deafened}
                volume={voiceRoom.volume}
                onConnect={() => void voiceRoom.join(activeChannel.id, serverId ?? null)}
                onLeave={() => void voiceRoom.leave()}
                onToggleMute={voiceRoom.toggleMuted}
                onToggleDeafen={voiceRoom.toggleDeafened}
                onVolumeChange={voiceRoom.setVolume}
              />
            </Suspense>
          ) : null}
        </div>

        {activeChannel && activeChannel.type !== "voice" ? (
          <MessageInput
            channelName={activeChannelName}
            onSubmit={submitMessage}
            replyingTo={replyTarget}
            editingMessage={editingMessage}
            onCancelReply={() => setReplyTarget(null)}
            onCancelEdit={() => setEditingMessage(null)}
            draftPreset={draftPreset}
            onFilesRejected={(rejected) => {
              const firstName = rejected[0]?.name ?? t("message.input_attach");
              pushToast(
                t("message.file_too_large_title"),
                t("message.file_too_large_desc", { file: firstName, count: rejected.length, limit: "50 MB" }),
              );
            }}
            onTyping={() => {
              if (!socket || socket.readyState !== WebSocket.OPEN || !textChannelId) {
                return;
              }
              socket.send(
                JSON.stringify({
                  t: "TYPING",
                  d: {
                    channel_id: textChannelId,
                    server_id: serverId,
                  },
                }),
              );
            }}
            typingText={activeTypingText}
          />
        ) : null}
      </section>

      <MemberList />

      <ConfirmDialog
        open={pendingDeleteMessage !== null}
        title={t("message.delete_confirm")}
        description={pendingDeleteMessage ? compactPreview(pendingDeleteMessage.content) : ""}
        confirmText={t("message.action_delete")}
        cancelText={t("message.cancel")}
        loading={deleteMessage.isPending}
        onCancel={() => setPendingDeleteMessage(null)}
        onConfirm={() => void confirmDeleteMessage()}
      />
    </div>
  );
};

export default ServerPage;
