import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  useCreateChannelMutation,
  useCreateMessageMutation,
  useDeleteMessageMutation,
  useDirectChannelsQuery,
  useCreateServerMutation,
  useFriendsQuery,
  useJoinServerMutation,
  useMeQuery,
  useMessagesQuery,
  useOpenDirectMessageMutation,
  useSendFriendRequestMutation,
  useServersQuery,
  useUploadAttachmentsMutation,
  useUpdateMessageMutation,
  useUpdateFriendRequestMutation,
} from "@/api/queries";
import type { UploadProgressEvent } from "@/api/client";
import { get } from "@/api/client";
import { MessageInput } from "@/components/chat/MessageInput";
import { MessageList } from "@/components/chat/MessageList";
import { Sidebar } from "@/components/layout/Sidebar";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import { useMessageStore } from "@/store/messageStore";
import { useServerStore } from "@/store/serverStore";
import { useUiStore } from "@/store/uiStore";
import type { Channel, FriendRelation, FriendStatus, Message } from "@/types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FriendTab = "online" | "all" | "add";

const formatPeerId = (relation: FriendRelation, currentUserId: string | null): string =>
  relation.requester_id === currentUserId ? relation.addressee_id : relation.requester_id;

const shortId = (value: string): string => value.slice(0, 8);
const compactPreview = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "...";
  }
  return normalized.slice(0, 90);
};

const pickLatestMessage = (messages: Message[]): Message | null => {
  if (messages.length === 0) {
    return null;
  }
  return messages.reduce((latest, current) =>
    new Date(current.created_at).getTime() > new Date(latest.created_at).getTime() ? current : latest,
  );
};

const formatPeerName = (relation: FriendRelation, currentUserId: string | null): string => {
  const peerId = formatPeerId(relation, currentUserId);
  const preferred = relation.requester_id === currentUserId ? relation.addressee_username : relation.requester_username;
  const normalized = preferred?.trim();
  return normalized && normalized.length > 0 ? normalized : shortId(peerId);
};

const formatPeerAvatar = (relation: FriendRelation, currentUserId: string | null): string | null => {
  return relation.requester_id === currentUserId ? relation.addressee_avatar_url ?? null : relation.requester_avatar_url ?? null;
};

const parseDmPeerId = (channel: Channel, currentUserId: string | null): string | null => {
  if (!currentUserId || channel.type !== "dm") {
    return null;
  }
  if (!channel.name.startsWith("dm:")) {
    return null;
  }

  const [, left, right] = channel.name.split(":");
  if (!left || !right) {
    return null;
  }

  if (left === currentUserId) {
    return right;
  }
  if (right === currentUserId) {
    return left;
  }
  return null;
};

const HomePage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const socket = useWebSocket();

  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const setServers = useServerStore((state) => state.setServers);
  const servers = useServerStore((state) => state.servers);
  const setActiveServer = useServerStore((state) => state.setActiveServer);

  const pushToast = useUiStore((state) => state.pushToast);
  const messagesByChannel = useMessageStore((state) => state.byChannel);
  const setMessages = useMessageStore((state) => state.setMessages);
  const removeMessageFromStore = useMessageStore((state) => state.deleteMessage);
  const typingByChannel = useMessageStore((state) => state.typingByChannel);

  const [tab, setTab] = useState<FriendTab>("online");
  const [search, setSearch] = useState("");
  const [serverName, setServerName] = useState("");
  const [joinServerId, setJoinServerId] = useState("");
  const [friendId, setFriendId] = useState("");
  const [selectedDm, setSelectedDm] = useState<{ channelId: string; peerId: string; peerName: string } | null>(null);
  const [replyTarget, setReplyTarget] = useState<{ id: string; author: string; preview: string } | null>(null);
  const [editingMessage, setEditingMessage] = useState<{ id: string; preview: string } | null>(null);
  const [draftPreset, setDraftPreset] = useState<{ key: string; text: string; mode?: "replace" | "append" } | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<Message | null>(null);
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const knownLastMessageByChannelRef = useRef<Record<string, string>>({});
  const prefetchedChannelIdsRef = useRef<Set<string>>(new Set());
  const lastReadAckByChannelRef = useRef<Record<string, string>>({});

  const { data: serverData } = useServersQuery();
  const { data: friends } = useFriendsQuery();
  const { data: meUser } = useMeQuery();
  const { data: dmChannels } = useDirectChannelsQuery();
  const { data: dmMessages } = useMessagesQuery(selectedDm?.channelId ?? null);

  const createServer = useCreateServerMutation();
  const createChannel = useCreateChannelMutation();
  const joinServer = useJoinServerMutation();
  const sendFriendRequest = useSendFriendRequestMutation();
  const updateFriendRequest = useUpdateFriendRequestMutation();
  const openDirectMessage = useOpenDirectMessageMutation();
  const createMessage = useCreateMessageMutation();
  const uploadAttachments = useUploadAttachmentsMutation();
  const updateMessage = useUpdateMessageMutation();
  const deleteMessage = useDeleteMessageMutation();

  useEffect(() => {
    if (serverData) {
      setServers(serverData);
    }
  }, [serverData, setServers]);

  useEffect(() => {
    if (selectedDm?.channelId && dmMessages) {
      setMessages(selectedDm.channelId, dmMessages);
    }
  }, [dmMessages, selectedDm?.channelId, setMessages]);

  useEffect(() => {
    const channelId = selectedDm?.channelId;
    if (!socket || !channelId) {
      return;
    }

    const subscribe = () => {
      socket.send(
        JSON.stringify({
          t: "SUBSCRIBE_SERVER",
          d: { channel_id: channelId },
        }),
      );
    };

    if (socket.readyState === WebSocket.OPEN) {
      subscribe();
      return;
    }

    socket.addEventListener("open", subscribe, { once: true });
    return () => socket.removeEventListener("open", subscribe);
  }, [selectedDm?.channelId, socket]);

  const effectiveUser = user ?? meUser ?? null;
  const currentUserId = effectiveUser?.id ?? null;

  const dmChannelByPeerId = useMemo(() => {
    const map: Record<string, Channel> = {};
    for (const channel of dmChannels ?? []) {
      const peerId = parseDmPeerId(channel, currentUserId);
      if (peerId) {
        map[peerId] = channel;
      }
    }
    return map;
  }, [currentUserId, dmChannels]);

  const selectedDmMessages = useMemo(
    () => (selectedDm ? messagesByChannel[selectedDm.channelId] ?? [] : []),
    [messagesByChannel, selectedDm],
  );

  useEffect(() => {
    setReplyTarget(null);
    setEditingMessage(null);
  }, [selectedDm?.channelId]);

  const dmTypingText = useMemo(() => {
    if (!selectedDm) {
      return null;
    }
    const typingMap = typingByChannel[selectedDm.channelId] ?? {};
    const typingUsers = Object.keys(typingMap).filter((userId) => userId !== currentUserId);
    if (typingUsers.length === 0) {
      return null;
    }
    if (typingUsers.length === 1) {
      return t("message.typing_user", { user: selectedDm.peerName });
    }
    return t("message.typing_many", { count: typingUsers.length });
  }, [currentUserId, selectedDm, t, typingByChannel]);

  useEffect(() => {
    const channels = dmChannels ?? [];
    if (channels.length === 0) {
      return;
    }

    for (const channel of channels) {
      if (!prefetchedChannelIdsRef.current.has(channel.id)) {
        prefetchedChannelIdsRef.current.add(channel.id);
        void get<Message[]>(`/messages?channel_id=${channel.id}&limit=50&mark_read=false`)
          .then((messages) => {
            setMessages(channel.id, messages);
          })
          .catch(() => {
            // Ignore preview prefetch errors.
          });
      }

      if (!socket) {
        continue;
      }
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: "SUBSCRIBE_SERVER", d: { channel_id: channel.id } }));
      } else {
        const onOpen = () => socket.send(JSON.stringify({ t: "SUBSCRIBE_SERVER", d: { channel_id: channel.id } }));
        socket.addEventListener("open", onOpen, { once: true });
      }
    }
  }, [dmChannels, setMessages, socket]);

  useEffect(() => {
    const channels = dmChannels ?? [];
    for (const channel of channels) {
      const list = messagesByChannel[channel.id] ?? [];
      if (list.length === 0) {
        continue;
      }
      const latest = list[list.length - 1];
      const knownId = knownLastMessageByChannelRef.current[channel.id];
      if (!knownId) {
        knownLastMessageByChannelRef.current[channel.id] = latest.id;
        continue;
      }
      if (knownId === latest.id) {
        continue;
      }

      knownLastMessageByChannelRef.current[channel.id] = latest.id;
      if (selectedDm?.channelId !== channel.id && latest.author_id !== currentUserId) {
        setUnreadByChannel((current) => ({ ...current, [channel.id]: (current[channel.id] ?? 0) + 1 }));
      }
    }
  }, [currentUserId, dmChannels, messagesByChannel, selectedDm?.channelId]);

  useEffect(() => {
    if (!selectedDm?.channelId) {
      return;
    }
    setUnreadByChannel((current) => {
      if (!current[selectedDm.channelId]) {
        return current;
      }
      return { ...current, [selectedDm.channelId]: 0 };
    });
  }, [selectedDm?.channelId]);

  useEffect(() => {
    if (!socket || !selectedDm?.channelId) {
      return;
    }
    const lastForeignMessage = [...selectedDmMessages].reverse().find((item) => item.author_id !== currentUserId);
    if (!lastForeignMessage) {
      return;
    }
    if (lastReadAckByChannelRef.current[selectedDm.channelId] === lastForeignMessage.id) {
      return;
    }
    lastReadAckByChannelRef.current[selectedDm.channelId] = lastForeignMessage.id;

    const sendReadAck = () => {
      socket.send(
        JSON.stringify({
          t: "MESSAGE_READ_ACK",
          d: {
            channel_id: selectedDm.channelId,
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
  }, [currentUserId, selectedDm?.channelId, selectedDmMessages, socket]);

  const statusLabels: Record<FriendStatus, string> = {
    pending: t("home.request_status_pending"),
    accepted: t("home.request_status_accepted"),
    blocked: t("home.request_status_blocked"),
  };

  const sortedFriends = useMemo(
    () => [...(friends ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [friends],
  );

  const acceptedFriends = useMemo(() => sortedFriends.filter((item) => item.status === "accepted"), [sortedFriends]);
  const pendingFriends = useMemo(() => sortedFriends.filter((item) => item.status === "pending"), [sortedFriends]);
  const incomingPendingFriends = useMemo(() => pendingFriends.filter((item) => item.addressee_id === currentUserId), [pendingFriends, currentUserId]);
  const outgoingPendingFriends = useMemo(() => pendingFriends.filter((item) => item.requester_id === currentUserId), [pendingFriends, currentUserId]);
  const isAddTab = tab === "add";

  const filteredFriends = useMemo(() => {
    const value = search.trim().toLowerCase();
    const source = tab === "online" ? acceptedFriends : sortedFriends;
    if (!value) {
      return source;
    }
    return source.filter((relation) => {
      const peerId = formatPeerId(relation, currentUserId).toLowerCase();
      const peerName = formatPeerName(relation, currentUserId).toLowerCase();
      return peerId.includes(value) || peerName.includes(value);
    });
  }, [acceptedFriends, currentUserId, search, sortedFriends, tab]);

  const handleCreateServer = async (event: FormEvent) => {
    event.preventDefault();
    const name = serverName.trim();
    if (name.length < 2) {
      return;
    }

    try {
      const server = await createServer.mutateAsync({
        name,
        icon_url: null,
        banner_url: null,
        region: null,
        is_nsfw: false,
      });

      try {
        await createChannel.mutateAsync({
          server_id: server.id,
          type: "text",
          name: "general",
          topic: null,
          position: 0,
          is_nsfw: false,
          slowmode_delay: 0,
          parent_id: null,
        });
      } catch (channelError) {
        pushToast(t("server.channel_create_failed"), channelError instanceof Error ? channelError.message : t("common.unknown_error"));
      }

      setServerName("");
      setActiveServer(server.id);
      pushToast(t("home.server_created"), t("home.server_created_desc", { name: server.name }));
      navigate(`/app/server/${server.id}`);
    } catch (error) {
      pushToast(t("home.server_create_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const handleJoinServer = async (event: FormEvent) => {
    event.preventDefault();
    const serverId = joinServerId.trim();
    if (!uuidPattern.test(serverId)) {
      pushToast(t("home.join_server_failed"), t("home.invalid_uuid"));
      return;
    }

    try {
      const server = await joinServer.mutateAsync({ serverId });
      setJoinServerId("");
      setActiveServer(server.id);
      pushToast(t("home.join_server_success"), server.name);
      navigate(`/app/server/${server.id}`);
    } catch (error) {
      pushToast(t("home.join_server_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const handleFriendRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (sendFriendRequest.isPending) {
      return;
    }
    const candidate = friendId.trim();
    if (!uuidPattern.test(candidate)) {
      pushToast(t("home.request_failed"), t("home.invalid_uuid"));
      return;
    }

    const existingRelation = sortedFriends.find((relation) => formatPeerId(relation, currentUserId) === candidate);
    if (existingRelation) {
      if (existingRelation.status === "accepted") {
        pushToast(t("home.request_failed"), t("home.request_exists_accepted"));
        return;
      }
      if (existingRelation.status === "blocked") {
        pushToast(t("home.request_failed"), t("home.request_exists_blocked"));
        return;
      }
      if (existingRelation.requester_id === currentUserId) {
        pushToast(t("home.request_failed"), t("home.request_exists_outgoing"));
        return;
      }
      pushToast(t("home.request_failed"), t("home.request_exists_incoming"));
      return;
    }

    try {
      await sendFriendRequest.mutateAsync({ addressee_id: candidate });
      setFriendId("");
      pushToast(t("home.request_sent"), t("home.request_sent_desc", { id: candidate }));
    } catch (error) {
      pushToast(t("home.request_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const handleAcceptFriendRequest = async (requesterId: string) => {
    try {
      await updateFriendRequest.mutateAsync({ requesterId, status: "accepted" });
      pushToast(t("home.request_accept_success"), t("home.request_accept_success_desc", { id: requesterId.slice(0, 8) }));
    } catch (error) {
      pushToast(t("home.request_accept_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const handleOpenDirectMessage = async (peerId: string, peerName: string) => {
    try {
      const existing = dmChannelByPeerId[peerId];
      if (existing) {
        setSelectedDm({ channelId: existing.id, peerId, peerName });
        return;
      }
      const channel = await openDirectMessage.mutateAsync({ friendId: peerId });
      setSelectedDm({ channelId: channel.id, peerId, peerName });
    } catch (error) {
      pushToast(t("home.open_dm_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
    }
  };

  const resolveMessageAuthor = (message: Message): string => {
    if (message.author_id === currentUserId) {
      return effectiveUser?.username ?? message.author_username ?? shortId(message.author_id);
    }
    const normalized = message.author_username?.trim();
    return normalized && normalized.length > 0 ? normalized : shortId(message.author_id);
  };

  const submitDirectMessage = async (content: string, files: File[], onProgress?: (entry: UploadProgressEvent) => void) => {
    if (!selectedDm?.channelId || (!content.trim() && files.length === 0)) {
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
        channel_id: selectedDm.channelId,
        content,
        nonce: null,
        type: replyTarget ? "reply" : "default",
        reference_id: replyTarget?.id ?? null,
      });

      if (files.length > 0) {
        await uploadAttachments.mutateAsync({
          messageId: created.id,
          channelId: selectedDm.channelId,
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

  const copyId = async () => {
    if (!effectiveUser?.id) {
      return;
    }

    try {
      await window.pawcord.clipboard.writeText(effectiveUser.id);
      pushToast(t("home.id_copied"), effectiveUser.id);
    } catch {
      try {
        await navigator.clipboard.writeText(effectiveUser.id);
        pushToast(t("home.id_copied"), effectiveUser.id);
      } catch {
        pushToast(t("home.id_copy_failed"), effectiveUser.id);
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

      <aside className="flex h-full w-80 flex-col border-r border-white/10 bg-black/20 p-2 backdrop-blur-sm">
        <div className="mb-2 space-y-1 px-1">
          <button
            type="button"
            className={`flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm font-semibold transition ${
              selectedDm === null && tab !== "add"
                ? "border-white/20 bg-white/[0.10] text-paw-text-primary"
                : "border-white/10 bg-black/25 text-paw-text-secondary hover:border-white/20 hover:bg-white/[0.06]"
            }`}
            onClick={() => {
              setSelectedDm(null);
              setTab("online");
            }}
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 6h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-6l-3 3v-3H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="truncate">{t("home.back_to_friends")}</span>
          </button>

          <button
            type="button"
            className={`flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm font-semibold transition ${
              selectedDm === null && tab === "add"
                ? "border-white/20 bg-white/[0.10] text-paw-text-primary"
                : "border-white/10 bg-black/25 text-paw-text-secondary hover:border-white/20 hover:bg-white/[0.06]"
            }`}
            onClick={() => {
              setSelectedDm(null);
              setTab("add");
            }}
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M4 7.5h16M5 7.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="m5 8 7 5 7-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="truncate">{t("home.sidebar_requests")}</span>
          </button>
        </div>
        <p className="px-2 text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("home.sidebar_direct_messages")}</p>
        <div className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {acceptedFriends.length === 0 ? <p className="px-2 text-xs text-paw-text-muted">{t("home.no_active_contacts")}</p> : null}
          {acceptedFriends.map((relation) => {
            const peerId = formatPeerId(relation, currentUserId);
            const peerName = formatPeerName(relation, currentUserId);
            const peerAvatar = formatPeerAvatar(relation, currentUserId);
            const active = selectedDm?.peerId === peerId;
            const channel = dmChannelByPeerId[peerId];
            const channelMessages = channel ? messagesByChannel[channel.id] ?? [] : [];
            const previewMessage = pickLatestMessage(channelMessages);
            const previewRaw = previewMessage?.content?.trim();
            const previewText = previewMessage ? compactPreview(previewRaw && previewRaw.length > 0 ? previewRaw : t("message.attachment_alt")) : t("home.dm_no_messages");
            const unreadFromSnapshot =
              currentUserId !== null
                ? channelMessages.filter((message) => message.author_id !== currentUserId && !(message.read_by ?? []).includes(currentUserId)).length
                : 0;
            const unreadFromLive = channel ? unreadByChannel[channel.id] ?? 0 : 0;
            const unreadCount = active ? 0 : Math.max(unreadFromLive, unreadFromSnapshot);
            const unreadLabel = unreadCount > 99 ? "99+" : unreadCount;
            return (
              <button
                key={`${relation.requester_id}:${relation.addressee_id}`}
                className={`group relative w-full overflow-hidden rounded-lg border px-2.5 py-2 text-left transition ${
                  active
                    ? "border-white/30 bg-white/[0.08] text-paw-text-primary shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                    : "border-transparent text-paw-text-secondary hover:border-white/10 hover:bg-paw-bg-elevated/70"
                }`}
                onClick={() => void handleOpenDirectMessage(peerId, peerName)}
              >
                {active ? <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r bg-white/90" /> : null}
                <div className="flex items-center gap-2">
                  <Avatar src={peerAvatar} label={peerName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="truncate text-sm font-semibold">{peerName}</p>
                        {active ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/85" /> : null}
                      </div>
                      {unreadCount > 0 ? (
                        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#3b82f6] px-2 text-xs font-bold leading-none text-white shadow-[0_0_0_2px_rgba(15,18,26,0.9)]">
                          {unreadLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-paw-text-muted">{previewText}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
          <div className="flex items-center gap-2">
            <Avatar src={effectiveUser?.avatar_url ?? null} label={effectiveUser?.username ?? "guest"} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-paw-text-secondary">{effectiveUser?.username ?? "guest"}</p>
              <p className="truncate text-xs text-paw-text-muted">{effectiveUser?.id?.slice(0, 8) ?? t("common.none")}</p>
            </div>
          </div>
          <div className="mt-2 flex gap-1">
            <Link to="/app/settings" className="flex-1">
              <Button className="w-full bg-black/25 px-2 py-1 text-xs text-paw-text-secondary shadow-none hover:bg-black/35">{t("home.settings")}</Button>
            </Link>
            <Button className="flex-1 bg-[#da373c] px-2 py-1 text-xs shadow-none" onClick={() => void clearAuth()}>
              {t("home.logout")}
            </Button>
          </div>
        </div>
      </aside>

      {selectedDm ? (
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 items-center border-b border-white/10 bg-black/20 px-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-paw-text-muted">@</span>
              <h2 className="text-[16px] font-semibold text-paw-text-secondary">{selectedDm.peerName}</h2>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden">
            <MessageList
              channelName={selectedDm.peerName}
              messages={selectedDmMessages}
              onReply={handleReplyToMessage}
              onEdit={handleEditMessage}
              onDelete={(message) => void handleDeleteMessage(message)}
              onForward={handleForwardMessage}
            />
          </div>
          <MessageInput
            channelName={selectedDm.peerName}
            onSubmit={async (content, files, onProgress) => submitDirectMessage(content, files, onProgress)}
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
              if (!socket || socket.readyState !== WebSocket.OPEN) {
                return;
              }
              socket.send(
                JSON.stringify({
                  t: "TYPING",
                  d: {
                    channel_id: selectedDm.channelId,
                  },
                }),
              );
            }}
            typingText={dmTypingText}
          />
        </section>
      ) : (
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 items-center gap-2 border-b border-white/10 bg-black/20 px-4">
            <button className={`rounded-md px-3 py-1 text-sm font-semibold ${tab === "online" ? "bg-paw-bg-elevated text-paw-text-primary" : "text-paw-text-muted hover:bg-paw-bg-elevated/70"}`} onClick={() => setTab("online")}>
              {t("home.tab_online")}
            </button>
            <button className={`rounded-md px-3 py-1 text-sm font-semibold ${tab === "all" ? "bg-paw-bg-elevated text-paw-text-primary" : "text-paw-text-muted hover:bg-paw-bg-elevated/70"}`} onClick={() => setTab("all")}>
              {t("home.tab_all")}
            </button>
            <button className={`rounded-md px-3 py-1 text-sm font-semibold ${tab === "add" ? "bg-paw-accent text-white" : "text-paw-text-muted hover:bg-paw-bg-elevated/70"}`} onClick={() => setTab("add")}>
              {t("home.tab_add_friend")}
            </button>
          </header>

          <div className="flex min-h-0 flex-1">
            <main className="flex-1 overflow-auto p-4">
              {isAddTab ? (
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
                  <div className="mb-5">
                    <h3 className="text-base font-semibold text-paw-text-secondary">{t("home.add_friend_title")}</h3>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-paw-text-muted">{t("home.add_friend_description")}</p>
                  </div>

                  <form onSubmit={handleFriendRequest} className="flex flex-col gap-3 md:flex-row">
                    <input
                      value={friendId}
                      onChange={(event) => setFriendId(event.target.value)}
                      placeholder={t("home.friend_id_placeholder")}
                      className="h-11 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-paw-text-secondary placeholder:text-paw-text-muted focus:border-paw-accent focus:outline-none"
                    />
                    <Button type="submit" className="min-w-[180px] justify-center" disabled={sendFriendRequest.isPending}>
                      {t("home.send_request")}
                    </Button>
                  </form>

                  <div className="mt-6 grid gap-4 xl:grid-cols-2">
                    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-3">
                        <h4 className="text-sm font-semibold text-paw-text-secondary">{t("home.incoming_requests_title")}</h4>
                        <p className="mt-1 text-xs leading-5 text-paw-text-muted">{t("home.incoming_requests_description")}</p>
                      </div>

                      <div className="space-y-2">
                        {incomingPendingFriends.length === 0 ? <p className="text-sm text-paw-text-muted">{t("home.no_incoming_requests")}</p> : null}
                        {incomingPendingFriends.map((relation) => {
                          const peerName = formatPeerName(relation, currentUserId);
                          const peerAvatar = formatPeerAvatar(relation, currentUserId);
                          return (
                            <div key={`${relation.requester_id}:${relation.addressee_id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar src={peerAvatar} label={peerName} size="sm" />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-paw-text-secondary">{peerName}</p>
                                  <p className="truncate text-xs text-paw-text-muted">{new Date(relation.created_at).toLocaleDateString()}</p>
                                </div>
                              </div>
                              <Button className="shrink-0 px-3 py-1.5 text-xs" disabled={updateFriendRequest.isPending} onClick={() => void handleAcceptFriendRequest(relation.requester_id)}>
                                {t("home.accept_request")}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-3">
                        <h4 className="text-sm font-semibold text-paw-text-secondary">{t("home.outgoing_requests_title")}</h4>
                        <p className="mt-1 text-xs leading-5 text-paw-text-muted">{t("home.outgoing_requests_description")}</p>
                      </div>

                      <div className="space-y-2">
                        {outgoingPendingFriends.length === 0 ? <p className="text-sm text-paw-text-muted">{t("home.no_outgoing_requests")}</p> : null}
                        {outgoingPendingFriends.map((relation) => {
                          const peerName = formatPeerName(relation, currentUserId);
                          const peerAvatar = formatPeerAvatar(relation, currentUserId);
                          return (
                            <div key={`${relation.requester_id}:${relation.addressee_id}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
                              <div className="flex min-w-0 items-center gap-3">
                                <Avatar src={peerAvatar} label={peerName} size="sm" />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-paw-text-secondary">{peerName}</p>
                                  <p className="truncate text-xs text-paw-text-muted">{new Date(relation.created_at).toLocaleDateString()}</p>
                                </div>
                              </div>
                              <span className="shrink-0 rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-paw-text-muted">
                                {statusLabels.pending}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </div>
                </section>
              ) : (
                <>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("home.search_friends_placeholder")}
                    className="mb-4 h-10 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm text-paw-text-secondary placeholder:text-paw-text-muted focus:border-paw-accent focus:outline-none"
                  />

                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-paw-text-muted">
                    {tab === "online" ? t("home.online_count", { count: acceptedFriends.length }) : t("home.all_count", { count: sortedFriends.length })}
                  </p>

                  {filteredFriends.length === 0 ? <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-4 text-sm text-paw-text-muted">{t("home.no_friends")}</p> : null}

                  <div className="space-y-0.5">
                    {filteredFriends.map((relation) => {
                      const peerId = formatPeerId(relation, currentUserId);
                      const peerName = formatPeerName(relation, currentUserId);
                      const peerAvatar = formatPeerAvatar(relation, currentUserId);
                      return (
                        <div key={`${relation.requester_id}:${relation.addressee_id}`} className="flex items-center justify-between rounded-lg border border-transparent px-3 py-2 hover:border-white/10 hover:bg-white/[0.03]">
                          <div className="flex min-w-0 items-center gap-2">
                            <Avatar src={peerAvatar} label={peerName} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-paw-text-secondary">{peerName}</p>
                              <p className="truncate text-xs text-paw-text-muted">{statusLabels[relation.status]}</p>
                            </div>
                          </div>
                          <p className="text-xs text-paw-text-muted">{new Date(relation.created_at).toLocaleDateString()}</p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </main>

            <aside className="hidden w-80 border-l border-white/10 bg-black/10 p-4 xl:block">
              <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <h4 className="mb-2 text-sm font-semibold text-paw-text-secondary">{t("home.tools_title")}</h4>

                <div className="mb-4 rounded-lg border border-white/10 bg-black/20 p-2 text-xs">
                  <p className="text-paw-text-muted">{t("home.my_id")}</p>
                  <p className="mt-1 truncate text-paw-text-secondary">{effectiveUser?.id ?? t("common.none")}</p>
                  <Button className="mt-2 w-full bg-black/25 text-xs text-paw-text-secondary shadow-none hover:bg-black/35" onClick={() => void copyId()}>
                    {t("home.copy_id")}
                  </Button>
                </div>

                <form onSubmit={handleCreateServer} className="space-y-2">
                  <label className="text-xs text-paw-text-muted">{t("home.server_name_label")}</label>
                  <input
                    value={serverName}
                    onChange={(event) => setServerName(event.target.value)}
                    placeholder={t("home.server_name_placeholder")}
                    className="h-9 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm text-paw-text-secondary placeholder:text-paw-text-muted focus:border-paw-accent focus:outline-none"
                  />
                  <Button type="submit" className="w-full" disabled={createServer.isPending || createChannel.isPending}>
                    {t("home.create_server_button")}
                  </Button>
                </form>

                <form onSubmit={handleJoinServer} className="mt-4 space-y-2">
                  <label className="text-xs text-paw-text-muted">{t("home.server_id_label")}</label>
                  <input
                    value={joinServerId}
                    onChange={(event) => setJoinServerId(event.target.value)}
                    placeholder={t("home.friend_id_placeholder")}
                    className="h-9 w-full rounded-md border border-white/10 bg-black/20 px-3 text-sm text-paw-text-secondary placeholder:text-paw-text-muted focus:border-paw-accent focus:outline-none"
                  />
                  <Button type="submit" className="w-full" disabled={joinServer.isPending}>
                    {t("home.join_server_button")}
                  </Button>
                </form>
              </section>
            </aside>
          </div>
        </section>
      )}

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

export default HomePage;
