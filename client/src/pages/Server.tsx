import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  useChannelsQuery,
  useCreateServerInviteMutation,
  useCreateChannelMutation,
  useCreateMessageMutation,
  useDeleteServerIconMutation,
  useLeaveServerMutation,
  useDeleteMessageMutation,
  useMessagesQuery,
  useServersQuery,
  useUpdateChannelMutation,
  useUpdateServerMutation,
  useUpdateMessageMutation,
  useUploadServerBannerMutation,
  useUploadServerIconMutation,
  useUploadAttachmentsMutation,
} from "@/api/queries";
import type { UploadProgressEvent } from "@/api/client";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { ChannelList } from "@/components/layout/ChannelList";
import { MemberList } from "@/components/layout/MemberList";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { AppLoader } from "@/components/ui/AppLoader";
import { useI18n } from "@/i18n/provider";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { useAuthStore } from "@/store/authStore";
import { useChannelStore } from "@/store/channelStore";
import { useMessageStore } from "@/store/messageStore";
import { useServerStore } from "@/store/serverStore";
import { useUiStore } from "@/store/uiStore";
import type { Channel, Message } from "@/types";

const VoiceChannel = lazy(() => import("@/components/voice/VoiceChannel").then((module) => ({ default: module.VoiceChannel })));
const SERVER_ICON_MAX_BYTES = 25 * 1024 * 1024;
const SERVER_BANNER_MAX_BYTES = 30 * 1024 * 1024;
const ALLOWED_SERVER_ICON_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif"]);

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
  const navigate = useNavigate();
  const { socket, voiceRoom, gatewayStatus, gatewayLatencyMs } = useRealtime();
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const currentUsername = useAuthStore((state) => state.user?.username ?? null);

  const [replyTarget, setReplyTarget] = useState<{ id: string; author: string; preview: string } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; preview: string } | null>(null);
  const [draftPreset, setDraftPreset] = useState<{ key: string; text: string; mode?: "replace" | "append" } | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<Message | null>(null);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [leaveServerConfirmOpen, setLeaveServerConfirmOpen] = useState(false);
  const [renameChannelTarget, setRenameChannelTarget] = useState<{ id: string; name: string; type: Channel["type"] } | null>(null);
  const [renameChannelDraft, setRenameChannelDraft] = useState("");
  const [serverNameDraft, setServerNameDraft] = useState("");
  const [serverIconFile, setServerIconFile] = useState<File | null>(null);
  const [serverIconPreview, setServerIconPreview] = useState<string | null>(null);
  const [serverBannerFile, setServerBannerFile] = useState<File | null>(null);
  const [serverBannerPreview, setServerBannerPreview] = useState<string | null>(null);
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
  const canManageServer = Boolean(currentServer && currentUserId && currentServer.owner_id === currentUserId);

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

  useEffect(
    () => () => {
      if (serverIconPreview?.startsWith("blob:")) {
        URL.revokeObjectURL(serverIconPreview);
      }
      if (serverBannerPreview?.startsWith("blob:")) {
        URL.revokeObjectURL(serverBannerPreview);
      }
    },
    [serverBannerPreview, serverIconPreview],
  );

  const createMessage = useCreateMessageMutation();
  const createServerInvite = useCreateServerInviteMutation();
  const uploadAttachments = useUploadAttachmentsMutation();
  const updateMessage = useUpdateMessageMutation();
  const deleteMessage = useDeleteMessageMutation();
  const createChannel = useCreateChannelMutation();
  const updateChannel = useUpdateChannelMutation();
  const updateServer = useUpdateServerMutation();
  const leaveServer = useLeaveServerMutation();
  const uploadServerIcon = useUploadServerIconMutation();
  const deleteServerIcon = useDeleteServerIconMutation();
  const uploadServerBanner = useUploadServerBannerMutation();
  const isSavingServerSettings = updateServer.isPending || uploadServerIcon.isPending || uploadServerBanner.isPending || deleteServerIcon.isPending;

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

  const openRenameChannel = (channelId: string) => {
    const channel = storedChannels.find((item) => item.id === channelId);
    if (!channel) {
      return;
    }
    setRenameChannelTarget({ id: channel.id, name: channel.name, type: channel.type });
    setRenameChannelDraft(channel.name);
  };

  const closeRenameChannel = () => {
    setRenameChannelTarget(null);
    setRenameChannelDraft("");
  };

  const saveRenameChannel = async () => {
    if (!renameChannelTarget || !serverId) {
      closeRenameChannel();
      return;
    }

    const nextName = renameChannelDraft.trim();
    if (nextName.length < 1 || nextName.length > 100) {
      pushToast(t("channels.rename_invalid_title"), t("channels.rename_invalid_desc"));
      return;
    }

    if (nextName === renameChannelTarget.name) {
      closeRenameChannel();
      return;
    }

    try {
      const updated = await updateChannel.mutateAsync({
        channelId: renameChannelTarget.id,
        serverId,
        name: nextName,
      });
      setChannels(
        storedChannels.map((channel) =>
          channel.id === updated.id
            ? {
                ...channel,
                name: updated.name,
              }
            : channel,
        ),
      );
      pushToast(t("channels.rename_success"), updated.type === "text" ? `#${updated.name}` : updated.name);
      closeRenameChannel();
    } catch (error) {
      pushToast(t("channels.rename_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const handleVoiceJoin = async (channelId: string) => {
    setActiveChannel(channelId);
    const joined = await voiceRoom.join(channelId, serverId ?? null);
    if (!joined) {
      pushToast(t("voice.connect_failed"), t("voice.connect_failed_desc"));
    }
  };

  const handleToggleScreenShare = async (preferredSourceId?: string): Promise<boolean> => {
    const wasSharing = voiceRoom.screenSharing;
    const ok = await voiceRoom.toggleScreenShare(preferredSourceId);
    if (!ok && !wasSharing) {
      pushToast(t("voice.screen_share_failed"), t("voice.screen_share_failed_desc"));
    }
    return ok;
  };

  const copyInvite = async () => {
    if (!serverId) {
      return;
    }

    let inviteLink: string;
    try {
      const createdInvite = await createServerInvite.mutateAsync({ serverId });
      const normalized = createdInvite.invite_url?.trim();
      if (!normalized) {
        pushToast(t("server.invite_copy_failed"), t("server.invite_generate_failed"));
        return;
      }
      inviteLink = normalized;
    } catch {
      pushToast(t("server.invite_copy_failed"), t("server.invite_generate_failed"));
      return;
    }

    const inviteText = t("server.invite_payload", {
      name: currentServer?.name ?? "Server",
      link: inviteLink,
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

  const openServerSettings = () => {
    setServerNameDraft(currentServer?.name ?? "");
    setServerIconFile(null);
    setServerIconPreview(currentServer?.icon_url ?? null);
    setServerBannerFile(null);
    setServerBannerPreview(currentServer?.banner_url ?? null);
    setServerSettingsOpen(true);
  };

  const closeServerSettings = () => {
    if (serverIconPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(serverIconPreview);
    }
    if (serverBannerPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(serverBannerPreview);
    }
    setLeaveServerConfirmOpen(false);
    setServerSettingsOpen(false);
    setServerIconFile(null);
    setServerIconPreview(null);
    setServerBannerFile(null);
    setServerBannerPreview(null);
  };

  const handleSelectServerIcon = (file: File | null) => {
    if (!file) {
      return;
    }
    if (!ALLOWED_SERVER_ICON_MIME_TYPES.has(file.type)) {
      pushToast(t("server.settings_icon_invalid_type_title"), t("server.settings_icon_invalid_type_desc"));
      return;
    }
    if (file.size > SERVER_ICON_MAX_BYTES) {
      pushToast(t("server.settings_icon_invalid_size_title"), t("server.settings_icon_invalid_size_desc"));
      return;
    }

    if (serverIconPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(serverIconPreview);
    }

    setServerIconFile(file);
    setServerIconPreview(URL.createObjectURL(file));
  };

  const handleSelectServerBanner = (file: File | null) => {
    if (!file) {
      return;
    }
    if (!ALLOWED_SERVER_ICON_MIME_TYPES.has(file.type)) {
      pushToast(t("server.settings_banner_invalid_type_title"), t("server.settings_banner_invalid_type_desc"));
      return;
    }
    if (file.size > SERVER_BANNER_MAX_BYTES) {
      pushToast(t("server.settings_banner_invalid_size_title"), t("server.settings_banner_invalid_size_desc"));
      return;
    }

    if (serverBannerPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(serverBannerPreview);
    }

    setServerBannerFile(file);
    setServerBannerPreview(URL.createObjectURL(file));
  };

  const handleDeleteServerIcon = async () => {
    if (!serverId || !canManageServer) {
      pushToast(t("server.settings_forbidden"), "");
      return;
    }

    try {
      await deleteServerIcon.mutateAsync({ serverId });
      if (serverIconPreview?.startsWith("blob:")) {
        URL.revokeObjectURL(serverIconPreview);
      }
      setServerIconFile(null);
      setServerIconPreview(null);
      pushToast(t("server.settings_icon_deleted_title"), t("server.settings_icon_deleted_desc"));
    } catch (error) {
      pushToast(t("server.settings_icon_delete_failed_title"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const saveServerSettings = async () => {
    if (!serverId || !canManageServer) {
      pushToast(t("server.settings_forbidden"), "");
      return;
    }

    const nextName = serverNameDraft.trim();
    if (nextName.length < 2 || nextName.length > 100) {
      pushToast(t("server.settings_name_invalid_title"), t("server.settings_name_invalid_desc"));
      return;
    }

    const nameChanged = nextName !== (currentServer?.name ?? "");
    const iconChanged = serverIconFile !== null;
    const bannerChanged = serverBannerFile !== null;

    if (!nameChanged && !iconChanged && !bannerChanged) {
      closeServerSettings();
      return;
    }

    try {
      if (nameChanged) {
        await updateServer.mutateAsync({ serverId, name: nextName });
      }
      if (iconChanged && serverIconFile) {
        await uploadServerIcon.mutateAsync({ serverId, file: serverIconFile });
      }
      if (bannerChanged && serverBannerFile) {
        await uploadServerBanner.mutateAsync({ serverId, file: serverBannerFile });
      }
      pushToast(t("server.settings_saved_title"), t("server.settings_saved_desc"));
      closeServerSettings();
    } catch (error) {
      pushToast(t("server.settings_save_failed_title"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const confirmLeaveServer = async () => {
    if (!serverId || canManageServer) {
      return;
    }

    try {
      if (voiceRoom.connectedChannelId) {
        await voiceRoom.leave();
      }
      await leaveServer.mutateAsync({ serverId });
      setLeaveServerConfirmOpen(false);
      closeServerSettings();
      setActiveChannel(null);
      setChannels([]);
      setActiveServer(null);
      navigate("/app/home");
      pushToast(t("server.settings_leave_success_title"), t("server.settings_leave_success_desc"));
    } catch (error) {
      pushToast(t("server.settings_leave_failed_title"), error instanceof Error ? error.message : t("common.unknown_error"));
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
      <ChannelList
        connectedVoiceChannelId={voiceRoom.connectedChannelId}
        onJoinVoice={(channelId) => {
          void handleVoiceJoin(channelId);
        }}
        onLeaveVoice={() => void voiceRoom.leave()}
        onRenameChannel={openRenameChannel}
        onCreateTextChannel={() => void handleCreateTextChannel()}
        onCreateVoiceChannel={() => void handleCreateVoiceChannel()}
        onInvite={() => void copyInvite()}
        onOpenServerSettings={openServerSettings}
        canManageServer={canManageServer}
        isCreatingChannel={createChannel.isPending}
        gatewayStatus={gatewayStatus}
        gatewayLatencyMs={gatewayLatencyMs}
      />

      <section className="flex min-w-0 flex-1 flex-col bg-paw-bg-primary">
        <header className="ui-header-bar flex items-center justify-between">
          <div className="min-w-0 flex items-center gap-3">
            <Avatar src={currentServer?.icon_url ?? null} label={currentServer?.name ?? "server"} size="sm" />
            <div className="min-w-0">
              <p className="typo-meta truncate font-semibold uppercase tracking-wide">{currentServer?.name ?? "Server"}</p>
              <p className="typo-title-md truncate">
                <span className="text-paw-text-muted"># </span>
                {activeChannel?.name ?? t("server.no_channel_selected")}
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2">
            <span
              className={`rounded-md border px-2 py-1 typo-meta font-semibold ${
                activeChannel?.type === "voice"
                  ? "border-[#248046]/45 bg-[#248046]/20 text-[#8ee6a8]"
                  : "border-white/10 bg-[#0f1116] text-paw-text-muted"
              }`}
            >
              {activeChannel?.type === "voice" ? "Voice" : "Text"}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {!activeChannel ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <p className="typo-title-md text-paw-text-primary">{t("server.no_channel_selected")}</p>
                <p className="typo-body mt-2 text-paw-text-secondary">{t("server.no_channel_hint")}</p>
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
            <Suspense fallback={<AppLoader compact title={t("server.loading_voice")} />}>
              <VoiceChannel
                serverName={currentServer?.name ?? null}
                channelId={activeChannel.id}
                channelName={activeChannelName}
                connected={voiceRoom.connectedChannelId === activeChannel.id}
                participants={voiceRoom.connectedChannelId === activeChannel.id ? voiceRoom.participants : []}
                remoteStreams={voiceRoom.remoteStreams}
                remoteScreenStreams={voiceRoom.remoteScreenStreams}
                localAudioStream={voiceRoom.localAudioStream}
                localScreenStream={voiceRoom.localScreenStream}
                screenShareFps={voiceRoom.screenShareFps}
                muted={voiceRoom.muted}
                deafened={voiceRoom.deafened}
                screenSharing={voiceRoom.screenSharing}
                volume={voiceRoom.volume}
                inputDevices={voiceRoom.inputDevices}
                selectedInputDeviceId={voiceRoom.selectedInputDeviceId}
                screenSources={voiceRoom.screenSources}
                selectedScreenSourceId={voiceRoom.selectedScreenSourceId}
                onConnect={() => void handleVoiceJoin(activeChannel.id)}
                onLeave={() => void voiceRoom.leave()}
                onToggleMute={voiceRoom.toggleMuted}
                onToggleDeafen={voiceRoom.toggleDeafened}
                onToggleScreenShare={handleToggleScreenShare}
                onVolumeChange={voiceRoom.setVolume}
                onInputDeviceChange={voiceRoom.setInputDevice}
                onRefreshScreenSources={voiceRoom.refreshScreenSources}
                onScreenSourceChange={voiceRoom.setScreenSource}
                onRecoverScreenShare={voiceRoom.recoverRemoteScreen}
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

      <Modal open={renameChannelTarget !== null} title={t("channels.rename_title")} onClose={closeRenameChannel}>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("channels.rename_label")}</label>
            <Input
              value={renameChannelDraft}
              onChange={(event) => setRenameChannelDraft(event.target.value)}
              placeholder={
                renameChannelTarget?.type === "voice" ? t("channels.rename_placeholder_voice") : t("channels.rename_placeholder_text")
              }
              className="popup-input"
              maxLength={100}
              autoFocus
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button className="popup-btn-secondary px-3 py-1.5 text-xs shadow-none" onClick={closeRenameChannel}>
              {t("message.cancel")}
            </Button>
            <Button
              className="popup-btn-primary px-3 py-1.5 text-xs shadow-none"
              onClick={() => void saveRenameChannel()}
              disabled={updateChannel.isPending}
            >
              {updateChannel.isPending ? t("server.settings_saving") : t("channels.rename_save")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={serverSettingsOpen} title={t("server.settings_title")} onClose={closeServerSettings}>
        <div className="space-y-4">
          {canManageServer ? (
            <>
              <div className="ui-surface flex items-center gap-3 bg-black/20 p-3 shadow-none">
                <Avatar src={serverIconPreview ?? currentServer?.icon_url ?? null} label={currentServer?.name ?? "server"} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="typo-body truncate font-semibold text-paw-text-secondary">{currentServer?.name ?? "Server"}</p>
                  <p className="typo-meta">{t("server.settings_icon_hint")}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <label className="cursor-pointer rounded-md border border-white/12 bg-black/25 px-3 py-1.5 text-xs font-semibold text-paw-text-secondary transition hover:border-white/20 hover:bg-black/35 hover:text-paw-text-primary">
                    {t("server.settings_icon_upload")}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif"
                      className="hidden"
                      onChange={(event) => handleSelectServerIcon(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <Button
                    className="bg-black/25 px-3 py-1.5 text-xs text-paw-text-secondary shadow-none hover:bg-black/35"
                    onClick={() => void handleDeleteServerIcon()}
                    disabled={deleteServerIcon.isPending || (!serverIconPreview && !currentServer?.icon_url)}
                  >
                    {t("server.settings_icon_delete")}
                  </Button>
                </div>
              </div>

              <div className="ui-surface space-y-2 bg-black/20 p-3 shadow-none">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="typo-body font-semibold text-paw-text-secondary">{t("server.settings_banner_title")}</p>
                    <p className="typo-meta">{t("server.settings_banner_hint")}</p>
                  </div>
                  <label className="cursor-pointer rounded-md border border-white/12 bg-black/25 px-3 py-1.5 text-xs font-semibold text-paw-text-secondary transition hover:border-white/20 hover:bg-black/35 hover:text-paw-text-primary">
                    {t("server.settings_banner_upload")}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif"
                      className="hidden"
                      onChange={(event) => handleSelectServerBanner(event.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>
                <div className="h-24 overflow-hidden rounded-lg border border-white/10 bg-black/25">
                  {serverBannerPreview ?? currentServer?.banner_url ? (
                    <img
                      src={serverBannerPreview ?? currentServer?.banner_url ?? ""}
                      alt={t("server.settings_banner_title")}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-paw-text-muted">{t("server.settings_banner_empty")}</div>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("server.settings_name_label")}</label>
                <Input
                  value={serverNameDraft}
                  onChange={(event) => setServerNameDraft(event.target.value)}
                  placeholder={t("server.settings_name_placeholder")}
                  className="popup-input"
                  maxLength={100}
                />
              </div>
            </>
          ) : (
            <div className="ui-surface bg-black/20 p-3 shadow-none">
              <p className="typo-meta">{t("server.settings_forbidden")}</p>
            </div>
          )}

          <div className="ui-surface space-y-2 bg-black/20 p-3 shadow-none">
            <p className="typo-body font-semibold text-paw-text-secondary">{t("server.settings_leave_title")}</p>
            <p className="typo-meta">{canManageServer ? t("server.settings_leave_owner_blocked") : t("server.settings_leave_desc")}</p>
            <div className="flex justify-end">
              <Button
                className="rounded-md border border-[#b3354b] bg-[#cc3d56] px-3 py-1.5 text-xs font-semibold text-white shadow-none transition hover:bg-[#db4a64] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => setLeaveServerConfirmOpen(true)}
                disabled={leaveServer.isPending || canManageServer}
              >
                {t("server.settings_leave_button")}
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button className="popup-btn-secondary px-3 py-1.5 text-xs shadow-none" onClick={closeServerSettings}>
              {t("message.cancel")}
            </Button>
            {canManageServer ? (
              <Button
                className="popup-btn-primary px-3 py-1.5 text-xs shadow-none"
                onClick={() => void saveServerSettings()}
                disabled={isSavingServerSettings}
              >
                {isSavingServerSettings ? t("server.settings_saving") : t("server.settings_save")}
              </Button>
            ) : null}
          </div>
        </div>
      </Modal>

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

      <ConfirmDialog
        open={leaveServerConfirmOpen}
        title={t("server.settings_leave_confirm_title")}
        description={t("server.settings_leave_confirm_desc")}
        confirmText={t("server.settings_leave_button")}
        cancelText={t("message.cancel")}
        loading={leaveServer.isPending}
        onCancel={() => setLeaveServerConfirmOpen(false)}
        onConfirm={() => void confirmLeaveServer()}
      />
    </div>
  );
};

export default ServerPage;

