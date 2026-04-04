import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  useCreateChannelMutation,
  useCreateMessageMutation,
  useDeleteMessageMutation,
  useDirectChannelsQuery,
  useCreateServerMutation,
  useFriendsQuery,
  useJoinServerMutation,
  useJoinServerByInviteMutation,
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
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { useI18n } from "@/i18n/provider";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { useAuthStore } from "@/store/authStore";
import { useChannelStore } from "@/store/channelStore";
import { useMessageStore } from "@/store/messageStore";
import { useServerStore } from "@/store/serverStore";
import { useUiStore } from "@/store/uiStore";
import {
  LAYOUT_CHANNEL_LIST_DEFAULT_WIDTH,
  CHANNEL_LIST_WIDTH_STORAGE_KEY,
  clampChannelListWidth,
  readStoredChannelListWidth,
} from "@/theme/layout";
import type { Channel, FriendRelation, FriendStatus, Message } from "@/types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidLoosePattern = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const inviteCodePattern = /^[A-Za-z0-9_-]{8,64}$/;
const serverSearchParamCandidates = ["server", "server_id", "serverId", "id"] as const;
const inviteSearchParamCandidates = ["invite", "invite_code", "inviteCode", "code"] as const;
const PENDING_SERVER_INVITE_STORAGE_KEY = "zcord.pending-server-invite";

type JoinServerTarget = { serverId: string | null; inviteCode: string | null };

const normalizeInviteCode = (value: string): string | null => {
  const trimmed = value.trim();
  return inviteCodePattern.test(trimmed) ? trimmed : null;
};

const extractJoinServerTarget = (rawValue: string): JoinServerTarget => {
  const value = rawValue.trim();
  if (!value) {
    return { serverId: null, inviteCode: null };
  }

  if (uuidPattern.test(value)) {
    return { serverId: value, inviteCode: null };
  }

  const inviteCodeCandidate = normalizeInviteCode(value);
  if (inviteCodeCandidate) {
    return { serverId: null, inviteCode: inviteCodeCandidate };
  }

  try {
    const parsedUrl = new URL(value);
    for (const key of serverSearchParamCandidates) {
      const candidate = parsedUrl.searchParams.get(key)?.trim();
      if (candidate && uuidPattern.test(candidate)) {
        return { serverId: candidate, inviteCode: null };
      }
    }
    for (const key of inviteSearchParamCandidates) {
      const candidate = parsedUrl.searchParams.get(key)?.trim();
      const normalized = candidate ? normalizeInviteCode(candidate) : null;
      if (normalized) {
        return { serverId: null, inviteCode: normalized };
      }
    }

    const segments = parsedUrl.pathname.split("/").map((item) => item.trim()).filter((item) => item.length > 0);
    const inviteIndex = segments.findIndex((segment) => segment.toLowerCase() === "invite");
    if (inviteIndex >= 0 && segments[inviteIndex + 1]) {
      const normalized = normalizeInviteCode(decodeURIComponent(segments[inviteIndex + 1]));
      if (normalized) {
        return { serverId: null, inviteCode: normalized };
      }
    }

    const pathMatch = parsedUrl.pathname.match(uuidLoosePattern);
    if (pathMatch?.[0] && uuidPattern.test(pathMatch[0])) {
      return { serverId: pathMatch[0], inviteCode: null };
    }
  } catch {
    // Not a URL, continue with loose UUID search.
  }

  const looseMatch = value.match(uuidLoosePattern);
  if (looseMatch?.[0]) {
    return { serverId: looseMatch[0], inviteCode: null };
  }

  return { serverId: null, inviteCode: null };
};

type FriendTab = "online" | "all" | "add";
type DmCallStage = "outgoing-ringing" | "incoming-ringing" | "connecting" | "connected";
type DmCallSignalType = "offer" | "answer" | "ice-candidate";

interface IncomingDmCallInvite {
  callId: string;
  channelId: string;
  callerId: string;
  callerName: string;
  callerAvatar: string | null;
  callerBanner: string | null;
}

interface ActiveDmCall {
  callId: string;
  channelId: string;
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  peerBanner: string | null;
  stage: DmCallStage;
  isCaller: boolean;
}

const DM_CALL_RING_INCOMING_PATH = "sounds/dm-call-incoming.wav";
const DM_CALL_RING_OUTGOING_PATH = "sounds/dm-call-outgoing.wav";
const DM_CALL_ACCEPT_PATH = "sounds/dm-call-accept.wav";
const DM_CALL_DECLINE_PATH = "sounds/dm-call-decline.wav";
const DM_CALL_END_PATH = "sounds/dm-call-end.wav";
const PENDING_DM_CALL_INVITE_STORAGE_KEY = "zcord.pending-dm-call-invite";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const resolveDmCallSoundUrl = (raw: string): string => {
  if (typeof window === "undefined") {
    return raw;
  }
  if (/^(https?:|file:|data:|blob:)/i.test(raw)) {
    return raw;
  }
  try {
    return new URL(raw, window.location.href).toString();
  } catch {
    return raw;
  }
};

const clearPendingDmCallInviteStorage = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.removeItem(PENDING_DM_CALL_INVITE_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
};

const buildDirectCallIceServers = (): RTCIceServer[] => {
  const stunConfigured = import.meta.env.VITE_WEBRTC_STUN_URLS as string | undefined;
  const stunUrls =
    typeof stunConfigured === "string" && stunConfigured.trim().length > 0
      ? stunConfigured
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"];

  const servers: RTCIceServer[] = [{ urls: stunUrls }];

  const turnConfigured = import.meta.env.VITE_WEBRTC_TURN_URL as string | undefined;
  const turnUsername = import.meta.env.VITE_WEBRTC_TURN_USERNAME as string | undefined;
  const turnCredential = import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL as string | undefined;
  const turnUrls =
    typeof turnConfigured === "string" && turnConfigured.trim().length > 0
      ? turnConfigured
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];

  if (turnUrls.length > 0 && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
};

const formatPeerId = (relation: FriendRelation, currentUserId: string | null): string =>
  relation.requester_id === currentUserId ? relation.addressee_id : relation.requester_id;

const shortId = (value: string): string => value.slice(0, 8);
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

const compactPreview = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "...";
  }
  return normalized.slice(0, 90);
};

const formatCallDuration = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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

const formatPeerBanner = (relation: FriendRelation, currentUserId: string | null): string | null => {
  return relation.requester_id === currentUserId ? relation.addressee_banner_url ?? null : relation.requester_banner_url ?? null;
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

interface HomePageProps {
  isRouteActive?: boolean;
}

const HomePage = ({ isRouteActive = true }: HomePageProps) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { socket, voiceRoom, gatewayStatus, gatewayLatencyMs } = useRealtime();

  const user = useAuthStore((state) => state.user);

  const channels = useChannelStore((state) => state.channels);
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
  const [panelWidth, setPanelWidth] = useState<number>(() => readStoredChannelListWidth());
  const resizeStateRef = useRef<{ active: boolean; startX: number; startWidth: number }>({
    active: false,
    startX: 0,
    startWidth: LAYOUT_CHANNEL_LIST_DEFAULT_WIDTH,
  });
  const knownLastMessageByChannelRef = useRef<Record<string, string>>({});
  const prefetchedChannelIdsRef = useRef<Set<string>>(new Set());
  const lastReadAckByChannelRef = useRef<Record<string, string>>({});
  const processedAutoJoinInviteRef = useRef<string | null>(null);

  const [incomingCallInvite, setIncomingCallInvite] = useState<IncomingDmCallInvite | null>(null);
  const [activeDmCall, setActiveDmCall] = useState<ActiveDmCall | null>(null);
  const [remoteCallStream, setRemoteCallStream] = useState<MediaStream | null>(null);
  const [callMuted, setCallMuted] = useState(false);
  const [callDeafened, setCallDeafened] = useState(false);
  const [dmCallElapsedSec, setDmCallElapsedSec] = useState(0);
  const [incomingCallPopupPosition, setIncomingCallPopupPosition] = useState<{ x: number; y: number }>(() => ({
    x: typeof window === "undefined" ? 0 : window.innerWidth / 2,
    y: typeof window === "undefined" ? 0 : window.innerHeight / 2,
  }));
  const [isIncomingCallPopupDragging, setIsIncomingCallPopupDragging] = useState(false);

  const incomingCallInviteRef = useRef<IncomingDmCallInvite | null>(null);
  const incomingCallPopupRef = useRef<HTMLDivElement | null>(null);
  const incomingCallPopupDragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const activeDmCallRef = useRef<ActiveDmCall | null>(null);
  const callPeerRef = useRef<RTCPeerConnection | null>(null);
  const callLocalStreamRef = useRef<MediaStream | null>(null);
  const pendingCallIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteCallAudioRef = useRef<HTMLAudioElement | null>(null);
  const callLoopAudioRef = useRef<{ incoming: HTMLAudioElement | null; outgoing: HTMLAudioElement | null }>({
    incoming: null,
    outgoing: null,
  });
  const callOneShotAudioRef = useRef<Record<"accept" | "decline" | "end", HTMLAudioElement | null>>({
    accept: null,
    decline: null,
    end: null,
  });
  const outgoingCallTimeoutRef = useRef<number | null>(null);
  const dmCallConnectedAtRef = useRef<number | null>(null);

  const dmCallIceServers = useMemo(() => buildDirectCallIceServers(), []);

  const { data: serverData } = useServersQuery();
  const { data: friends } = useFriendsQuery();
  const { data: meUser } = useMeQuery();
  const { data: dmChannels } = useDirectChannelsQuery();
  const { data: dmMessages } = useMessagesQuery(selectedDm?.channelId ?? null);

  const createServer = useCreateServerMutation();
  const createChannel = useCreateChannelMutation();
  const joinServer = useJoinServerMutation();
  const joinServerByInvite = useJoinServerByInviteMutation();
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
    if (!isRouteActive || typeof window === "undefined") {
      return;
    }

    let rawInviteCode: string | null = null;
    try {
      rawInviteCode = window.sessionStorage.getItem(PENDING_SERVER_INVITE_STORAGE_KEY);
    } catch {
      rawInviteCode = null;
    }

    const inviteCode = rawInviteCode ? normalizeInviteCode(rawInviteCode) : null;
    if (!inviteCode || processedAutoJoinInviteRef.current === inviteCode) {
      return;
    }

    processedAutoJoinInviteRef.current = inviteCode;
    try {
      window.sessionStorage.removeItem(PENDING_SERVER_INVITE_STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }

    void (async () => {
      try {
        const server = await joinServerByInvite.mutateAsync({ inviteCode });
        setActiveServer(server.id);
        pushToast(t("home.join_server_success"), server.name);
        navigate(`/app/server/${server.id}`);
      } catch (error) {
        pushToast(t("home.join_server_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
      }
    })();
  }, [isRouteActive, joinServerByInvite, navigate, pushToast, setActiveServer, t]);

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
  const activeDmCallStageLabel = useMemo(() => {
    if (!activeDmCall) {
      return "";
    }
    if (activeDmCall.stage === "outgoing-ringing") {
      return t("dm.call_ringing");
    }
    if (activeDmCall.stage === "incoming-ringing") {
      return t("dm.call_incoming");
    }
    if (activeDmCall.stage === "connecting") {
      return t("dm.call_connecting");
    }
    return t("dm.call_connected");
  }, [activeDmCall, t]);

  const clampIncomingCallPopupPosition = useCallback(
    (x: number, y: number, width?: number, height?: number): { x: number; y: number } => {
      if (typeof window === "undefined") {
        return { x, y };
      }
      const popupWidth = width ?? incomingCallPopupRef.current?.offsetWidth ?? 290;
      const popupHeight = height ?? incomingCallPopupRef.current?.offsetHeight ?? 320;
      const margin = 20;
      const minX = margin + popupWidth / 2;
      const maxX = Math.max(minX, window.innerWidth - margin - popupWidth / 2);
      const minY = margin + popupHeight / 2;
      const maxY = Math.max(minY, window.innerHeight - margin - popupHeight / 2);
      return {
        x: Math.min(maxX, Math.max(minX, x)),
        y: Math.min(maxY, Math.max(minY, y)),
      };
    },
    [],
  );

  const centerIncomingCallPopup = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    setIncomingCallPopupPosition(clampIncomingCallPopupPosition(window.innerWidth / 2, window.innerHeight / 2));
  }, [clampIncomingCallPopupPosition]);

  useEffect(() => {
    incomingCallInviteRef.current = incomingCallInvite;
  }, [incomingCallInvite]);

  useEffect(() => {
    if (!incomingCallInvite) {
      incomingCallPopupDragRef.current = null;
      setIsIncomingCallPopupDragging(false);
      return;
    }
    centerIncomingCallPopup();
  }, [centerIncomingCallPopup, incomingCallInvite]);

  useEffect(() => {
    if (!incomingCallInvite || typeof window === "undefined") {
      return;
    }
    const handleResize = () => {
      setIncomingCallPopupPosition((prev) => clampIncomingCallPopupPosition(prev.x, prev.y));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampIncomingCallPopupPosition, incomingCallInvite]);

  useEffect(() => {
    activeDmCallRef.current = activeDmCall;
  }, [activeDmCall]);

  const handleIncomingCallPopupPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const popup = incomingCallPopupRef.current;
    if (!popup) {
      return;
    }
    event.preventDefault();
    const popupRect = popup.getBoundingClientRect();
    incomingCallPopupDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - popupRect.left,
      offsetY: event.clientY - popupRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsIncomingCallPopupDragging(true);
  }, []);

  const handleIncomingCallPopupPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = incomingCallPopupDragRef.current;
      const popup = incomingCallPopupRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !popup) {
        return;
      }
      const nextLeft = event.clientX - drag.offsetX;
      const nextTop = event.clientY - drag.offsetY;
      setIncomingCallPopupPosition(
        clampIncomingCallPopupPosition(
          nextLeft + popup.offsetWidth / 2,
          nextTop + popup.offsetHeight / 2,
          popup.offsetWidth,
          popup.offsetHeight,
        ),
      );
    },
    [clampIncomingCallPopupPosition],
  );

  const handleIncomingCallPopupPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = incomingCallPopupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    incomingCallPopupDragRef.current = null;
    setIsIncomingCallPopupDragging(false);
  }, []);

  const focusActiveCallChat = useCallback(() => {
    const call = activeDmCallRef.current;
    if (!call) {
      return;
    }
    setSelectedDm({
      channelId: call.channelId,
      peerId: call.peerId,
      peerName: call.peerName,
    });
    navigate("/app/home");
  }, [navigate]);

  useEffect(() => {
    if (!activeDmCall) {
      dmCallConnectedAtRef.current = null;
      setDmCallElapsedSec(0);
      return;
    }
    if (activeDmCall.stage === "connected") {
      if (dmCallConnectedAtRef.current === null) {
        dmCallConnectedAtRef.current = Date.now();
        setDmCallElapsedSec(0);
      }
      return;
    }
    dmCallConnectedAtRef.current = null;
    setDmCallElapsedSec(0);
  }, [activeDmCall?.callId, activeDmCall?.stage]);

  useEffect(() => {
    if (!activeDmCall || activeDmCall.stage !== "connected" || dmCallConnectedAtRef.current === null) {
      return;
    }
    const tick = () => {
      if (dmCallConnectedAtRef.current === null) {
        setDmCallElapsedSec(0);
        return;
      }
      setDmCallElapsedSec(Math.floor((Date.now() - dmCallConnectedAtRef.current) / 1000));
    };
    tick();
    const timerId = window.setInterval(tick, 1000);
    return () => window.clearInterval(timerId);
  }, [activeDmCall?.callId, activeDmCall?.stage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeDmCallRef.current) {
        return;
      }
      const key = event.key.toLowerCase();
      const isReturnHotkey = (event.ctrlKey || event.metaKey) && event.shiftKey && key === "r";
      if (!isReturnHotkey) {
        return;
      }
      event.preventDefault();
      focusActiveCallChat();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusActiveCallChat]);

  const sendRealtimeEvent = useCallback(
    (type: string, data: Record<string, unknown>): boolean => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify({ t: type, d: data }));
      return true;
    },
    [socket],
  );

  const resolvePeerMeta = useCallback(
    (peerId: string): { name: string; avatar: string | null; banner: string | null } => {
      const relation = (friends ?? []).find((item) => formatPeerId(item, currentUserId) === peerId);
      if (!relation) {
        return { name: shortId(peerId), avatar: null, banner: null };
      }
      return {
        name: formatPeerName(relation, currentUserId),
        avatar: formatPeerAvatar(relation, currentUserId),
        banner: formatPeerBanner(relation, currentUserId),
      };
    },
    [currentUserId, friends],
  );

  const stopCallLoopingSounds = useCallback(() => {
    for (const key of ["incoming", "outgoing"] as const) {
      const audio = callLoopAudioRef.current[key];
      if (!audio) {
        continue;
      }
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const getLoopSound = useCallback((kind: "incoming" | "outgoing"): HTMLAudioElement => {
    const existing = callLoopAudioRef.current[kind];
    if (existing) {
      return existing;
    }

    const configured =
      kind === "incoming"
        ? (import.meta.env.VITE_DM_CALL_RING_INCOMING_URL as string | undefined)
        : (import.meta.env.VITE_DM_CALL_RING_OUTGOING_URL as string | undefined);
    const path = kind === "incoming" ? DM_CALL_RING_INCOMING_PATH : DM_CALL_RING_OUTGOING_PATH;
    const audio = new Audio(resolveDmCallSoundUrl(typeof configured === "string" && configured.trim().length > 0 ? configured.trim() : path));
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0.48;
    callLoopAudioRef.current[kind] = audio;
    return audio;
  }, []);

  const startCallLoopingSound = useCallback(
    (kind: "incoming" | "outgoing") => {
      const audio = getLoopSound(kind);
      for (const key of ["incoming", "outgoing"] as const) {
        if (key !== kind) {
          const other = callLoopAudioRef.current[key];
          if (other) {
            other.pause();
            other.currentTime = 0;
          }
        }
      }
      audio.currentTime = 0;
      const playback = audio.play();
      if (playback && typeof playback.catch === "function") {
        void playback.catch(() => undefined);
      }
    },
    [getLoopSound],
  );

  useEffect(() => {
    if (incomingCallInviteRef.current || activeDmCallRef.current) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(PENDING_DM_CALL_INVITE_STORAGE_KEY);
    } catch {
      return;
    }

    if (!raw) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      clearPendingDmCallInviteStorage();
      return;
    }
    if (!isRecord(parsed)) {
      clearPendingDmCallInviteStorage();
      return;
    }

    const callId = parsed.call_id;
    const channelId = parsed.channel_id;
    const callerId = parsed.caller_id;
    const targetUserId = parsed.target_user_id;
    if (typeof callId !== "string" || typeof channelId !== "string" || typeof callerId !== "string") {
      clearPendingDmCallInviteStorage();
      return;
    }
    if (typeof targetUserId === "string" && currentUserId && targetUserId !== currentUserId) {
      clearPendingDmCallInviteStorage();
      return;
    }

    const peerMeta = resolvePeerMeta(callerId);
    const invite: IncomingDmCallInvite = {
      callId,
      channelId,
      callerId,
      callerName: typeof parsed.caller_name === "string" && parsed.caller_name.trim().length > 0 ? parsed.caller_name : peerMeta.name,
      callerAvatar: typeof parsed.caller_avatar_url === "string" ? parsed.caller_avatar_url : peerMeta.avatar,
      callerBanner: typeof parsed.caller_banner_url === "string" ? parsed.caller_banner_url : peerMeta.banner,
    };
    setIncomingCallInvite(invite);
    incomingCallInviteRef.current = invite;
    startCallLoopingSound("incoming");
    clearPendingDmCallInviteStorage();
  }, [currentUserId, resolvePeerMeta, startCallLoopingSound]);

  const getOneShotCallSound = useCallback((kind: "accept" | "decline" | "end"): HTMLAudioElement => {
    const existing = callOneShotAudioRef.current[kind];
    if (existing) {
      return existing;
    }

    let configured: string | undefined;
    let path = DM_CALL_ACCEPT_PATH;
    if (kind === "accept") {
      configured = import.meta.env.VITE_DM_CALL_ACCEPT_SOUND_URL as string | undefined;
      path = DM_CALL_ACCEPT_PATH;
    } else if (kind === "decline") {
      configured = import.meta.env.VITE_DM_CALL_DECLINE_SOUND_URL as string | undefined;
      path = DM_CALL_DECLINE_PATH;
    } else {
      configured = import.meta.env.VITE_DM_CALL_END_SOUND_URL as string | undefined;
      path = DM_CALL_END_PATH;
    }

    const audio = new Audio(resolveDmCallSoundUrl(typeof configured === "string" && configured.trim().length > 0 ? configured.trim() : path));
    audio.preload = "auto";
    audio.volume = 0.56;
    callOneShotAudioRef.current[kind] = audio;
    return audio;
  }, []);

  const playOneShotCallSound = useCallback(
    (kind: "accept" | "decline" | "end") => {
      const audio = getOneShotCallSound(kind);
      audio.currentTime = 0;
      const playback = audio.play();
      if (playback && typeof playback.catch === "function") {
        void playback.catch(() => undefined);
      }
    },
    [getOneShotCallSound],
  );

  const clearOutgoingCallTimeout = useCallback(() => {
    if (outgoingCallTimeoutRef.current !== null) {
      window.clearTimeout(outgoingCallTimeoutRef.current);
      outgoingCallTimeoutRef.current = null;
    }
  }, []);

  const ensureLocalCallStream = useCallback(async (): Promise<MediaStream> => {
    if (callLocalStreamRef.current) {
      return callLocalStreamRef.current;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    callLocalStreamRef.current = stream;
    setCallMuted(false);
    return stream;
  }, []);

  const cleanupDirectCall = useCallback(
    (options?: { notifyPeer?: boolean; playEndCue?: boolean }) => {
      const call = activeDmCallRef.current;
      clearOutgoingCallTimeout();
      stopCallLoopingSounds();

      if (options?.notifyPeer && call) {
        sendRealtimeEvent("DM_CALL_END", {
          channel_id: call.channelId,
          call_id: call.callId,
        });
      }

      if (callPeerRef.current) {
        callPeerRef.current.onicecandidate = null;
        callPeerRef.current.ontrack = null;
        callPeerRef.current.onconnectionstatechange = null;
        callPeerRef.current.close();
        callPeerRef.current = null;
      }

      if (callLocalStreamRef.current) {
        for (const track of callLocalStreamRef.current.getTracks()) {
          track.stop();
        }
        callLocalStreamRef.current = null;
      }

      pendingCallIceCandidatesRef.current = [];
      setRemoteCallStream(null);
      setCallMuted(false);
      setCallDeafened(false);
      setIncomingCallInvite(null);
      incomingCallInviteRef.current = null;
      clearPendingDmCallInviteStorage();
      setActiveDmCall(null);
      activeDmCallRef.current = null;

      if (options?.playEndCue) {
        playOneShotCallSound("end");
      }
    },
    [clearOutgoingCallTimeout, playOneShotCallSound, sendRealtimeEvent, stopCallLoopingSounds],
  );

  const ensureCallPeer = useCallback(
    (call: ActiveDmCall, localStream: MediaStream): RTCPeerConnection => {
      const existing = callPeerRef.current;
      if (existing) {
        return existing;
      }

      const peer = new RTCPeerConnection({ iceServers: dmCallIceServers });
      callPeerRef.current = peer;

      localStream.getAudioTracks().forEach((track) => {
        peer.addTrack(track, localStream);
      });

      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        const active = activeDmCallRef.current;
        if (!active) {
          return;
        }
        sendRealtimeEvent("DM_CALL_SIGNAL", {
          channel_id: active.channelId,
          call_id: active.callId,
          target_user_id: active.peerId,
          signal_type: "ice-candidate",
          payload: event.candidate.toJSON(),
        });
      };

      peer.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) {
          setRemoteCallStream(stream);
          return;
        }
        const generated = new MediaStream([event.track]);
        setRemoteCallStream(generated);
      };

      peer.onconnectionstatechange = () => {
        const active = activeDmCallRef.current;
        if (!active) {
          return;
        }
        if (peer.connectionState === "connected") {
          setActiveDmCall({ ...active, stage: "connected" });
          return;
        }
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected" || peer.connectionState === "closed") {
          cleanupDirectCall({ notifyPeer: false, playEndCue: false });
        }
      };

      return peer;
    },
    [cleanupDirectCall, dmCallIceServers, sendRealtimeEvent],
  );

  const applyRemoteCallDescription = useCallback(async (peer: RTCPeerConnection, description: RTCSessionDescriptionInit) => {
    await peer.setRemoteDescription(description);
    const queued = pendingCallIceCandidatesRef.current;
    if (queued.length > 0) {
      pendingCallIceCandidatesRef.current = [];
      for (const candidate of queued) {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // Ignore malformed candidates.
        }
      }
    }
  }, []);

  const processCallSignal = useCallback(
    async (callId: string, fromUserId: string, signalType: DmCallSignalType, payload: Record<string, unknown>) => {
      const active = activeDmCallRef.current;
      if (!active || active.callId !== callId) {
        return;
      }

      let localStream: MediaStream;
      try {
        localStream = await ensureLocalCallStream();
      } catch (error) {
        pushToast(t("voice.connect_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
        cleanupDirectCall({ notifyPeer: true, playEndCue: false });
        return;
      }

      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !callMuted;
      });

      const peer = ensureCallPeer(active, localStream);

      if (signalType === "offer") {
        const sdp = payload.sdp;
        if (typeof sdp !== "string") {
          return;
        }
        try {
          await applyRemoteCallDescription(peer, { type: "offer", sdp });
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          sendRealtimeEvent("DM_CALL_SIGNAL", {
            channel_id: active.channelId,
            call_id: active.callId,
            target_user_id: fromUserId,
            signal_type: "answer",
            payload: answer,
          });
          setActiveDmCall({ ...active, stage: "connecting" });
        } catch {
          cleanupDirectCall({ notifyPeer: true, playEndCue: false });
        }
        return;
      }

      if (signalType === "answer") {
        const sdp = payload.sdp;
        if (typeof sdp !== "string" || peer.signalingState !== "have-local-offer") {
          return;
        }
        try {
          await applyRemoteCallDescription(peer, { type: "answer", sdp });
          setActiveDmCall({ ...active, stage: "connecting" });
        } catch {
          cleanupDirectCall({ notifyPeer: true, playEndCue: false });
        }
        return;
      }

      const candidate = payload.candidate;
      if (typeof candidate !== "string") {
        return;
      }
      const candidateInit: RTCIceCandidateInit = {
        candidate,
        sdpMid: typeof payload.sdpMid === "string" ? payload.sdpMid : null,
        sdpMLineIndex: typeof payload.sdpMLineIndex === "number" ? payload.sdpMLineIndex : null,
        usernameFragment: typeof payload.usernameFragment === "string" ? payload.usernameFragment : null,
      };

      if (!peer.remoteDescription) {
        pendingCallIceCandidatesRef.current.push(candidateInit);
        return;
      }
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidateInit));
      } catch {
        // Ignore malformed candidates.
      }
    },
    [applyRemoteCallDescription, callMuted, cleanupDirectCall, ensureCallPeer, ensureLocalCallStream, pushToast, sendRealtimeEvent, t],
  );

  useEffect(() => {
    const audio = remoteCallAudioRef.current;
    if (!audio) {
      return;
    }
    audio.muted = callDeafened;
    if (!remoteCallStream) {
      audio.srcObject = null;
      return;
    }
    audio.srcObject = remoteCallStream;
    const playback = audio.play();
    if (playback && typeof playback.catch === "function") {
      void playback.catch(() => undefined);
    }
  }, [callDeafened, remoteCallStream]);

  const startDirectCall = useCallback(async () => {
    if (!selectedDm) {
      return;
    }
    if (activeDmCallRef.current || incomingCallInviteRef.current) {
      return;
    }

    const callId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const peerMeta = resolvePeerMeta(selectedDm.peerId);

    const nextCall: ActiveDmCall = {
      callId,
      channelId: selectedDm.channelId,
      peerId: selectedDm.peerId,
      peerName: selectedDm.peerName,
      peerAvatar: peerMeta.avatar,
      peerBanner: peerMeta.banner,
      stage: "outgoing-ringing",
      isCaller: true,
    };
    setActiveDmCall(nextCall);
    activeDmCallRef.current = nextCall;
    startCallLoopingSound("outgoing");

    const sent = sendRealtimeEvent("DM_CALL_INVITE", {
      channel_id: selectedDm.channelId,
      call_id: callId,
      target_user_id: selectedDm.peerId,
    });
    if (!sent) {
      cleanupDirectCall({ notifyPeer: false, playEndCue: false });
      pushToast(t("voice.connect_failed"), t("common.unknown_error"));
      return;
    }

    clearOutgoingCallTimeout();
    outgoingCallTimeoutRef.current = window.setTimeout(() => {
      const active = activeDmCallRef.current;
      if (!active || active.callId !== callId || active.stage !== "outgoing-ringing") {
        return;
      }
      cleanupDirectCall({ notifyPeer: true, playEndCue: false });
      pushToast(t("dm.call_missed"), t("dm.call_no_answer"));
    }, 30_000);
  }, [cleanupDirectCall, clearOutgoingCallTimeout, pushToast, resolvePeerMeta, selectedDm, sendRealtimeEvent, startCallLoopingSound, t]);

  const declineIncomingCall = useCallback(() => {
    const invite = incomingCallInviteRef.current;
    if (!invite) {
      return;
    }
    stopCallLoopingSounds();
    playOneShotCallSound("decline");
    sendRealtimeEvent("DM_CALL_DECLINE", {
      channel_id: invite.channelId,
      call_id: invite.callId,
      reason: "declined",
    });
    setIncomingCallInvite(null);
    incomingCallInviteRef.current = null;
    clearPendingDmCallInviteStorage();
  }, [playOneShotCallSound, sendRealtimeEvent, stopCallLoopingSounds]);

  const acceptIncomingCall = useCallback(async () => {
    const invite = incomingCallInviteRef.current;
    if (!invite) {
      return;
    }

    stopCallLoopingSounds();
    playOneShotCallSound("accept");
    setIncomingCallInvite(null);
    incomingCallInviteRef.current = null;
    clearPendingDmCallInviteStorage();
    setSelectedDm({
      channelId: invite.channelId,
      peerId: invite.callerId,
      peerName: invite.callerName,
    });

    const nextCall: ActiveDmCall = {
      callId: invite.callId,
      channelId: invite.channelId,
      peerId: invite.callerId,
      peerName: invite.callerName,
      peerAvatar: invite.callerAvatar,
      peerBanner: invite.callerBanner,
      stage: "connecting",
      isCaller: false,
    };
    setActiveDmCall(nextCall);
    activeDmCallRef.current = nextCall;

    sendRealtimeEvent("DM_CALL_ACCEPT", {
      channel_id: invite.channelId,
      call_id: invite.callId,
    });

    try {
      await ensureLocalCallStream();
    } catch (error) {
      pushToast(t("voice.connect_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
      cleanupDirectCall({ notifyPeer: true, playEndCue: false });
    }
  }, [cleanupDirectCall, ensureLocalCallStream, playOneShotCallSound, pushToast, sendRealtimeEvent, stopCallLoopingSounds, t]);

  const endDirectCall = useCallback(() => {
    cleanupDirectCall({ notifyPeer: true, playEndCue: true });
  }, [cleanupDirectCall]);

  const toggleDirectCallMute = useCallback(() => {
    const nextMuted = !callMuted;
    setCallMuted(nextMuted);
    const stream = callLocalStreamRef.current;
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
    }
  }, [callMuted]);

  const toggleDirectCallDeafen = useCallback(() => {
    setCallDeafened((current) => !current);
  }, []);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const onMessage = (event: MessageEvent<string>) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isRecord(parsed)) {
        return;
      }

      const type = parsed.t;
      const data = parsed.d;
      if (typeof type !== "string" || !isRecord(data)) {
        return;
      }

      if (type === "DM_CALL_INVITE") {
        const callId = data.call_id;
        const channelId = data.channel_id;
        const callerId = data.caller_id;
        const targetUserId = data.target_user_id;
        if (typeof callId !== "string" || typeof channelId !== "string" || typeof callerId !== "string") {
          return;
        }
        if (callerId === currentUserId) {
          return;
        }
        if (typeof targetUserId === "string" && targetUserId !== currentUserId) {
          return;
        }

        if (activeDmCallRef.current || incomingCallInviteRef.current) {
          sendRealtimeEvent("DM_CALL_DECLINE", {
            channel_id: channelId,
            call_id: callId,
            reason: "busy",
          });
          return;
        }

        const peerMeta = resolvePeerMeta(callerId);
        const invite: IncomingDmCallInvite = {
          callId,
          channelId,
          callerId,
          callerName: typeof data.caller_name === "string" && data.caller_name.trim().length > 0 ? data.caller_name : peerMeta.name,
          callerAvatar: typeof data.caller_avatar_url === "string" ? data.caller_avatar_url : peerMeta.avatar,
          callerBanner: typeof data.caller_banner_url === "string" ? data.caller_banner_url : peerMeta.banner,
        };
        setIncomingCallInvite(invite);
        incomingCallInviteRef.current = invite;
        startCallLoopingSound("incoming");
        return;
      }

      if (type === "DM_CALL_ACCEPT") {
        const callId = data.call_id;
        const userId = data.user_id;
        const active = activeDmCallRef.current;
        if (!active || typeof callId !== "string" || typeof userId !== "string") {
          return;
        }
        if (active.callId !== callId || active.peerId !== userId || !active.isCaller) {
          return;
        }

        clearOutgoingCallTimeout();
        stopCallLoopingSounds();
        playOneShotCallSound("accept");
        const connecting = { ...active, stage: "connecting" as const };
        setActiveDmCall(connecting);
        activeDmCallRef.current = connecting;

        void (async () => {
          try {
            const local = await ensureLocalCallStream();
            local.getAudioTracks().forEach((track) => {
              track.enabled = !callMuted;
            });
            const peer = ensureCallPeer(connecting, local);
            const offer = await peer.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: false,
            });
            await peer.setLocalDescription(offer);
            sendRealtimeEvent("DM_CALL_SIGNAL", {
              channel_id: connecting.channelId,
              call_id: connecting.callId,
              target_user_id: connecting.peerId,
              signal_type: "offer",
              payload: offer,
            });
          } catch (error) {
            pushToast(t("voice.connect_failed"), error instanceof Error ? error.message : t("common.unknown_error"));
            cleanupDirectCall({ notifyPeer: true, playEndCue: false });
          }
        })();
        return;
      }

      if (type === "DM_CALL_DECLINE") {
        const callId = data.call_id;
        const userId = data.user_id;
        const active = activeDmCallRef.current;
        if (typeof callId !== "string" || typeof userId !== "string") {
          return;
        }

        if (incomingCallInviteRef.current && incomingCallInviteRef.current.callId === callId) {
          setIncomingCallInvite(null);
          incomingCallInviteRef.current = null;
          stopCallLoopingSounds();
        }

        if (!active || active.callId !== callId || active.peerId !== userId) {
          return;
        }
        clearOutgoingCallTimeout();
        stopCallLoopingSounds();
        playOneShotCallSound("decline");
        cleanupDirectCall({ notifyPeer: false, playEndCue: false });
        pushToast(t("dm.call_declined"), active.peerName);
        return;
      }

      if (type === "DM_CALL_END") {
        const callId = data.call_id;
        const userId = data.user_id;
        const active = activeDmCallRef.current;
        if (typeof callId !== "string" || typeof userId !== "string") {
          return;
        }
        if (incomingCallInviteRef.current && incomingCallInviteRef.current.callId === callId) {
          setIncomingCallInvite(null);
          incomingCallInviteRef.current = null;
          stopCallLoopingSounds();
          return;
        }
        if (!active || active.callId !== callId || active.peerId !== userId) {
          return;
        }
        clearOutgoingCallTimeout();
        cleanupDirectCall({ notifyPeer: false, playEndCue: true });
        return;
      }

      if (type === "DM_CALL_SIGNAL") {
        const callId = data.call_id;
        const userId = data.user_id;
        const signalType = data.signal_type;
        const payload = data.payload;
        if (typeof callId !== "string" || typeof userId !== "string") {
          return;
        }
        if (userId === currentUserId) {
          return;
        }
        if (signalType !== "offer" && signalType !== "answer" && signalType !== "ice-candidate") {
          return;
        }
        if (!isRecord(payload)) {
          return;
        }
        void processCallSignal(callId, userId, signalType, payload);
      }
    };

    socket.addEventListener("message", onMessage as EventListener);
    return () => {
      socket.removeEventListener("message", onMessage as EventListener);
    };
  }, [
    callMuted,
    cleanupDirectCall,
    clearOutgoingCallTimeout,
    currentUserId,
    ensureCallPeer,
    ensureLocalCallStream,
    playOneShotCallSound,
    processCallSignal,
    pushToast,
    resolvePeerMeta,
    sendRealtimeEvent,
    socket,
    startCallLoopingSound,
    stopCallLoopingSounds,
    t,
  ]);

  useEffect(() => {
    return () => {
      cleanupDirectCall({ notifyPeer: true, playEndCue: false });
      for (const key of ["incoming", "outgoing"] as const) {
        const audio = callLoopAudioRef.current[key];
        if (!audio) {
          continue;
        }
        audio.pause();
        audio.src = "";
        callLoopAudioRef.current[key] = null;
      }
      for (const key of ["accept", "decline", "end"] as const) {
        const audio = callOneShotAudioRef.current[key];
        if (!audio) {
          continue;
        }
        audio.pause();
        audio.src = "";
        callOneShotAudioRef.current[key] = null;
      }
    };
  }, [cleanupDirectCall]);

  const handleResizeMove = useCallback((event: PointerEvent) => {
    const state = resizeStateRef.current;
    if (!state.active) {
      return;
    }
    const deltaX = event.clientX - state.startX;
    setPanelWidth(clampChannelListWidth(state.startWidth + deltaX));
  }, []);

  const stopResize = useCallback(() => {
    if (!resizeStateRef.current.active) {
      return;
    }
    resizeStateRef.current.active = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("pointermove", handleResizeMove);
    window.removeEventListener("pointerup", stopResize);
  }, [handleResizeMove]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      resizeStateRef.current.active = true;
      resizeStateRef.current.startX = event.clientX;
      resizeStateRef.current.startWidth = panelWidth;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      window.addEventListener("pointermove", handleResizeMove);
      window.addEventListener("pointerup", stopResize);
    },
    [handleResizeMove, panelWidth, stopResize],
  );

  useEffect(() => {
    window.localStorage.setItem(CHANNEL_LIST_WIDTH_STORAGE_KEY, String(Math.round(panelWidth)));
  }, [panelWidth]);

  useEffect(() => {
    return () => {
      stopResize();
    };
  }, [stopResize]);

  const gatewayStatusLabel = useMemo(() => {
    if (gatewayStatus === "connected") {
      return t("voice.connected");
    }
    if (gatewayStatus === "connecting") {
      return "Connecting";
    }
    if (gatewayStatus === "reconnecting") {
      return "Reconnecting";
    }
    return t("voice.not_connected");
  }, [gatewayStatus, t]);

  const connectedVoiceChannel = useMemo(() => {
    if (!voiceRoom.connectedChannelId) {
      return null;
    }
    return channels.find((item) => item.id === voiceRoom.connectedChannelId) ?? null;
  }, [channels, voiceRoom.connectedChannelId]);

  const connectedVoiceServer = useMemo(() => {
    if (!connectedVoiceChannel?.server_id) {
      return null;
    }
    return servers.find((item) => item.id === connectedVoiceChannel.server_id) ?? null;
  }, [connectedVoiceChannel?.server_id, servers]);

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
  const getPeerPresenceLabel = (relation: FriendRelation): string => {
    if (relation.peer_is_online) {
      return t("members.group_online");
    }
    if (relation.peer_was_recently_online) {
      return t("members.group_recently");
    }
    return t("members.group_offline");
  };

  const sortedFriends = useMemo(
    () => [...(friends ?? [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [friends],
  );

  const acceptedFriends = useMemo(() => sortedFriends.filter((item) => item.status === "accepted"), [sortedFriends]);
  const onlineFriends = useMemo(() => acceptedFriends.filter((item) => item.peer_is_online), [acceptedFriends]);
  const pendingFriends = useMemo(() => sortedFriends.filter((item) => item.status === "pending"), [sortedFriends]);
  const incomingPendingFriends = useMemo(() => pendingFriends.filter((item) => item.addressee_id === currentUserId), [pendingFriends, currentUserId]);
  const outgoingPendingFriends = useMemo(() => pendingFriends.filter((item) => item.requester_id === currentUserId), [pendingFriends, currentUserId]);
  const isAddTab = tab === "add";

  const filteredFriends = useMemo(() => {
    const value = search.trim().toLowerCase();
    const source = tab === "online" ? onlineFriends : sortedFriends;
    if (!value) {
      return source;
    }
    return source.filter((relation) => {
      const peerId = formatPeerId(relation, currentUserId).toLowerCase();
      const peerName = formatPeerName(relation, currentUserId).toLowerCase();
      return peerId.includes(value) || peerName.includes(value);
    });
  }, [currentUserId, onlineFriends, search, sortedFriends, tab]);

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
    const target = extractJoinServerTarget(joinServerId);
    if (!target.serverId && !target.inviteCode) {
      pushToast(t("home.join_server_failed"), t("home.invalid_server_invite"));
      return;
    }

    try {
      const server = target.serverId
        ? await joinServer.mutateAsync({ serverId: target.serverId })
        : await joinServerByInvite.mutateAsync({ inviteCode: target.inviteCode as string });
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

  const activeDmCallForSelectedChat =
    isRouteActive && selectedDm && activeDmCall && activeDmCall.channelId === selectedDm.channelId
      ? activeDmCall
      : null;
  const activeDmCallBackgroundBanner = useMemo(() => {
    if (!activeDmCallForSelectedChat) {
      return null;
    }
    const peerBanner = activeDmCallForSelectedChat.peerBanner?.trim();
    if (peerBanner && peerBanner.length > 0) {
      return peerBanner;
    }
    const ownBanner = effectiveUser?.banner_url?.trim();
    return ownBanner && ownBanner.length > 0 ? ownBanner : null;
  }, [activeDmCallForSelectedChat, effectiveUser?.banner_url]);

  const renderCallStatePills = (compact = false) => {
    if (!activeDmCall) {
      return null;
    }
    const pills: JSX.Element[] = [];
    if (callMuted) {
      pills.push(
        <span key="muted" className="call-state-pill call-state-pill--danger">
          {t("voice.mute")}
        </span>,
      );
    }
    if (callDeafened) {
      pills.push(
        <span key="deafened" className="call-state-pill call-state-pill--danger">
          {t("voice.deafen")}
        </span>,
      );
    }
    if (activeDmCall.stage === "connected") {
      pills.push(
        <span key="duration" className="call-state-pill">
          {formatCallDuration(dmCallElapsedSec)}
        </span>,
      );
    }
    if (pills.length === 0) {
      return null;
    }
    return <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "" : "justify-center"}`}>{pills}</div>;
  };

  return (
    <>
      {isRouteActive ? (
        <div className="home-layout flex h-full overflow-hidden bg-paw-bg-primary">
      <aside className="home-dm-sidebar relative flex h-full shrink-0 flex-col border-r border-black/35 bg-paw-bg-secondary p-2" style={{ width: `${panelWidth}px` }}>
        <div className="mb-2 space-y-1 px-1">
          <button
            type="button"
            className={`flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm font-semibold leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35 ${
              selectedDm === null && tab !== "add"
                ? "border-white/20 bg-[var(--state-active-bg)] text-paw-text-primary"
                : "border-white/10 bg-[var(--color-bg-secondary)] text-paw-text-secondary hover:bg-[var(--state-hover-bg)]"
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
            className={`flex h-9 w-full items-center gap-2 rounded-md border px-3 text-sm font-semibold leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35 ${
              selectedDm === null && tab === "add"
                ? "border-white/20 bg-[var(--state-active-bg)] text-paw-text-primary"
                : "border-white/10 bg-[var(--color-bg-secondary)] text-paw-text-secondary hover:bg-[var(--state-hover-bg)]"
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
        <p className="typo-meta px-2 font-semibold uppercase tracking-wide">{t("home.sidebar_direct_messages")}</p>
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
            const unreadFromSnapshotMessages =
              currentUserId !== null
                ? channelMessages.filter((message) => message.author_id !== currentUserId && !(message.read_by ?? []).includes(currentUserId))
                : [];
            const unreadFromSnapshot = unreadFromSnapshotMessages.length;
            const unreadFromLive = channel ? unreadByChannel[channel.id] ?? 0 : 0;
            const unreadCount = active ? 0 : Math.max(unreadFromLive, unreadFromSnapshot);
            const unreadLabel = unreadCount > 99 ? "99+" : unreadCount;
            const hasMentionInUnread =
              !active &&
              unreadFromSnapshotMessages.some((message) =>
                hasMentionForCurrentUser(message.content, currentUserId, effectiveUser?.username ?? null),
              );
            const rowStateClass = hasMentionInUnread ? "ui-state-mention" : unreadCount > 0 ? "ui-state-unread" : "";
            return (
              <button
                key={`${relation.requester_id}:${relation.addressee_id}`}
                className={`home-dm-item ui-focus-ring ui-state-pressed group relative w-full overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-colors duration-150 ${rowStateClass} ${
                  active
                    ? "border-white/20 bg-[var(--state-active-bg)] text-paw-text-primary"
                    : "border-transparent text-paw-text-secondary hover:bg-[var(--state-hover-bg)]"
                }`}
                onClick={() => void handleOpenDirectMessage(peerId, peerName)}
              >
                {active ? <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r bg-white/90" /> : null}
                {!active && hasMentionInUnread ? <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r bg-[var(--state-mention-marker)]" /> : null}
                {!active && !hasMentionInUnread && unreadCount > 0 ? <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r bg-[var(--state-unread-marker)]" /> : null}
                <div className="flex items-center gap-2">
                  <Avatar src={peerAvatar} label={peerName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="typo-body truncate font-semibold">{peerName}</p>
                        {active ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/85" /> : null}
                      </div>
                      {unreadCount > 0 ? (
                        <span className="home-dm-unread-badge inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-paw-accent px-2 text-xs font-bold leading-none text-white shadow-[0_0_0_2px_rgba(15,18,26,0.9)]">
                          {unreadLabel}
                        </span>
                      ) : null}
                    </div>
                    <p className="typo-meta mt-0.5 truncate">{previewText}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {voiceRoom.connectedChannelId ? (
          <div className="home-voice-card mt-2 rounded-lg border border-[#248046]/35 bg-[#1a2d1f] px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="typo-meta truncate font-semibold text-[#8ee6a8]">{t("voice.connected")}</p>
              <span
                className={`home-voice-status-pill rounded-full border px-2 py-0.5 typo-meta font-semibold uppercase tracking-wide ${
                  gatewayStatus === "connected"
                    ? "border-[#248046]/35 bg-[#248046]/25 text-[#8ee6a8]"
                    : gatewayStatus === "reconnecting" || gatewayStatus === "connecting"
                      ? "border-[#f4b942]/35 bg-[#f4b942]/20 text-[#ffd890]"
                      : "border-white/15 bg-[var(--color-bg-tertiary)] text-paw-text-muted"
                }`}
              >
                {gatewayStatusLabel}
              </span>
            </div>
            <p className="typo-meta mt-1 truncate text-paw-text-secondary">
              #{connectedVoiceChannel?.name ?? t("voice.title")}
              {connectedVoiceServer?.name ? ` / ${connectedVoiceServer.name}` : ""}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="typo-meta text-paw-text-muted">
                Ping: {gatewayLatencyMs !== null ? `${Math.round(gatewayLatencyMs)} ms` : "-"}
              </p>
              <button
                type="button"
                onClick={() => void voiceRoom.leave()}
                className="home-voice-leave-btn rounded-md border border-white/15 bg-[var(--color-bg-tertiary)] px-2 py-0.5 typo-meta font-semibold text-paw-text-secondary transition-colors hover:bg-[var(--color-bg-secondary)] hover:text-paw-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35"
              >
                {t("voice.leave")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="ui-profile-card mt-2 p-2">
          <div className="flex items-center gap-2">
            <Avatar src={effectiveUser?.avatar_url ?? null} label={effectiveUser?.username ?? "guest"} size="sm" />
            <div className="min-w-0">
              <p className="ui-profile-name typo-body truncate font-semibold">{effectiveUser?.username ?? "guest"}</p>
              <p className="typo-meta truncate">{effectiveUser?.id?.slice(0, 8) ?? t("common.none")}</p>
            </div>
          </div>
          <div className="mt-2">
            <Link to="/app/settings" className="block w-full">
              <Button variant="secondary" size="sm" className="ui-profile-card-btn w-full">{t("home.settings")}</Button>
            </Link>
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize channels panel"
          onPointerDown={startResize}
          className="home-dm-sidebar-resizer absolute inset-y-0 right-0 z-30 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-white/10"
        />
      </aside>

      {selectedDm ? (
        <section className="home-chat-zone flex min-w-0 flex-1 flex-col">
          <header className="home-chat-header ui-header-bar flex items-center">
            <div className="flex items-center gap-2">
              <span className="typo-body text-paw-text-muted">@</span>
              <h2 className="typo-title-md">{selectedDm.peerName}</h2>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void startDirectCall()}
                disabled={Boolean(activeDmCallRef.current) || Boolean(incomingCallInviteRef.current)}
                className="dm-chat-call-btn"
                title={t("dm.call_button")}
                aria-label={t("dm.call_button")}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M6.9 3.5h3.6c.6 0 1.1.4 1.3 1l1 3.3c.2.7-.1 1.4-.7 1.7l-1.6.8c1 2 2.6 3.6 4.6 4.6l.8-1.6c.3-.6 1-.9 1.7-.7l3.3 1c.6.2 1 .7 1 1.3v3.6c0 .8-.6 1.4-1.4 1.5h-1.1C10.1 21 3 13.9 2 5.1V3.9C2 3.1 2.6 2.5 3.4 2.5h3.5Z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </header>

          {activeDmCallForSelectedChat ? (
            <div className="home-call-strip call-strip-surface ui-anim-fade border-b border-black/35">
              <div className="relative h-[240px] overflow-hidden">
                {activeDmCallBackgroundBanner ? (
                  <img
                    src={activeDmCallBackgroundBanner}
                    alt=""
                    aria-hidden
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-30 blur-[1px]"
                  />
                ) : null}
                <div className="dm-call-banner-overlay pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.46),rgba(0,0,0,0.86))]" />
                <div className="call-state-pill call-state-pill--active absolute right-4 top-4 z-[2]">
                  {activeDmCallForSelectedChat.stage === "connected"
                    ? `${t("dm.call_connected")} | ${formatCallDuration(dmCallElapsedSec)}`
                    : activeDmCallStageLabel}
                </div>

                <div className="relative z-[1] flex h-full flex-col items-center justify-center pb-14 pt-6">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="dm-call-avatar-shell rounded-full border border-white/14 bg-[rgba(9,11,15,0.92)] p-1">
                      <Avatar src={effectiveUser?.avatar_url ?? null} label={effectiveUser?.username ?? "you"} size="lg" online />
                    </div>
                    <div className="dm-call-avatar-shell rounded-full border border-white/14 bg-[rgba(9,11,15,0.92)] p-1">
                      <Avatar src={activeDmCallForSelectedChat.peerAvatar} label={activeDmCallForSelectedChat.peerName} size="lg" online />
                    </div>
                  </div>
                  <p className="dm-call-peer-name max-w-[420px] truncate">{activeDmCallForSelectedChat.peerName}</p>
                  <p className="dm-call-stage-text mt-1">{activeDmCallStageLabel}</p>
                  <div className="mt-2">{renderCallStatePills()}</div>
                </div>

                <div className="absolute bottom-5 left-1/2 z-[2] -translate-x-1/2">
                  <div className="call-control-dock dm-call-control-dock">
                    <button
                      type="button"
                      onClick={toggleDirectCallMute}
                      className={`call-control-btn dm-call-control-btn ${callMuted ? "call-control-btn--active" : ""}`}
                      title={callMuted ? t("dm.call_unmute") : t("dm.call_mute")}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 1 0 6 0V7a3 3 0 0 0-3-3Z" stroke="currentColor" strokeWidth="1.7" />
                        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        {callMuted ? <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> : null}
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={toggleDirectCallDeafen}
                      className={`call-control-btn dm-call-control-btn ${callDeafened ? "call-control-btn--active" : ""}`}
                      title={callDeafened ? t("dm.call_undeafen") : t("dm.call_deafen")}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M3 10v4h4l5 4V6L7 10H3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                        <path d="M16 9a5 5 0 0 1 0 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        {callDeafened ? <path d="M4 4l16 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> : null}
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={endDirectCall}
                      className="dm-call-hangup-btn"
                      title={t("dm.call_end")}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M6 12c3.5-3 8.5-3 12 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M8 14.5h8v3a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-3Z" fill="currentColor" />
                      </svg>
                      <span>{t("dm.call_end")}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="home-message-list-wrap min-h-0 flex-1 overflow-hidden">
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
        <section className="home-friends-zone flex min-w-0 flex-1 flex-col">
          <header className="home-friends-header ui-header-bar flex items-center gap-2">
            <button
              className={`rounded-md px-3 py-1 typo-body font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35 ${
                tab === "online" ? "bg-[var(--state-active-bg)] text-paw-text-primary" : "text-paw-text-muted hover:bg-[var(--state-hover-bg)]"
              }`}
              onClick={() => setTab("online")}
            >
              {t("home.tab_online")}
            </button>
            <button
              className={`rounded-md px-3 py-1 typo-body font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35 ${
                tab === "all" ? "bg-[var(--state-active-bg)] text-paw-text-primary" : "text-paw-text-muted hover:bg-[var(--state-hover-bg)]"
              }`}
              onClick={() => setTab("all")}
            >
              {t("home.tab_all")}
            </button>
            <button
              className={`rounded-md px-3 py-1 typo-body font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35 ${
                tab === "add" ? "bg-paw-accent text-white" : "text-paw-text-muted hover:bg-[var(--state-hover-bg)]"
              }`}
              onClick={() => setTab("add")}
            >
              {t("home.tab_add_friend")}
            </button>
          </header>

          <div className="flex min-h-0 flex-1">
            <main className="home-friends-main flex-1 overflow-auto p-4">
              {isAddTab ? (
                <section className="ui-surface p-5">
                  <div className="mb-5">
                    <h3 className="typo-title-md">{t("home.add_friend_title")}</h3>
                    <p className="typo-body mt-1 max-w-2xl text-paw-text-muted">{t("home.add_friend_description")}</p>
                  </div>

                  <form onSubmit={handleFriendRequest} className="flex flex-col gap-3 md:flex-row">
                    <Input
                      value={friendId}
                      onChange={(event) => setFriendId(event.target.value)}
                      placeholder={t("home.friend_id_placeholder")}
                      className="h-11 flex-1 rounded-xl px-4"
                    />
                    <Button type="submit" className="min-w-[180px] justify-center" disabled={sendFriendRequest.isPending}>
                      {t("home.send_request")}
                    </Button>
                  </form>

                  <div className="mt-6 grid gap-4 xl:grid-cols-2">
                    <section className="home-requests-card ui-surface-elevated rounded-xl border border-white/10 p-4">
                      <div className="mb-3">
                        <h4 className="typo-body font-semibold text-paw-text-secondary">{t("home.incoming_requests_title")}</h4>
                        <p className="typo-meta mt-1 leading-5">{t("home.incoming_requests_description")}</p>
                      </div>

                      <div className="space-y-2">
                        {incomingPendingFriends.length === 0 ? <p className="text-sm text-paw-text-muted">{t("home.no_incoming_requests")}</p> : null}
                        {incomingPendingFriends.map((relation) => {
                          const peerName = formatPeerName(relation, currentUserId);
                          const peerAvatar = formatPeerAvatar(relation, currentUserId);
                          return (
                            <div key={`${relation.requester_id}:${relation.addressee_id}`} className="home-request-row flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
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

                    <section className="home-requests-card ui-surface-elevated rounded-xl border border-white/10 p-4">
                      <div className="mb-3">
                        <h4 className="typo-body font-semibold text-paw-text-secondary">{t("home.outgoing_requests_title")}</h4>
                        <p className="typo-meta mt-1 leading-5">{t("home.outgoing_requests_description")}</p>
                      </div>

                      <div className="space-y-2">
                        {outgoingPendingFriends.length === 0 ? <p className="text-sm text-paw-text-muted">{t("home.no_outgoing_requests")}</p> : null}
                        {outgoingPendingFriends.map((relation) => {
                          const peerName = formatPeerName(relation, currentUserId);
                          const peerAvatar = formatPeerAvatar(relation, currentUserId);
                          return (
                            <div key={`${relation.requester_id}:${relation.addressee_id}`} className="home-request-row flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
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
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("home.search_friends_placeholder")}
                    className="mb-4"
                  />

                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-paw-text-muted">
                    {tab === "online" ? t("home.online_count", { count: onlineFriends.length }) : t("home.all_count", { count: sortedFriends.length })}
                  </p>

                  {filteredFriends.length === 0 ? <p className="home-no-friends rounded-lg border border-white/10 bg-white/[0.03] px-3 py-4 text-sm text-paw-text-muted">{t("home.no_friends")}</p> : null}

                  <div className="space-y-0.5">
                    {filteredFriends.map((relation) => {
                      const peerId = formatPeerId(relation, currentUserId);
                      const peerName = formatPeerName(relation, currentUserId);
                      const peerAvatar = formatPeerAvatar(relation, currentUserId);
                      const channel = dmChannelByPeerId[peerId];
                      const channelMessages = channel ? messagesByChannel[channel.id] ?? [] : [];
                      const unreadSnapshotMessages =
                        currentUserId !== null
                          ? channelMessages.filter((message) => message.author_id !== currentUserId && !(message.read_by ?? []).includes(currentUserId))
                          : [];
                      const unreadSnapshotCount = unreadSnapshotMessages.length;
                      const unreadLiveCount = channel ? unreadByChannel[channel.id] ?? 0 : 0;
                      const unreadCount = Math.max(unreadSnapshotCount, unreadLiveCount);
                      const unreadLabel = unreadCount > 99 ? "99+" : unreadCount;
                      const hasMentionInUnread = unreadSnapshotMessages.some((message) =>
                        hasMentionForCurrentUser(message.content, currentUserId, effectiveUser?.username ?? null),
                      );
                      const rowStateClass = hasMentionInUnread ? "ui-state-mention" : unreadCount > 0 ? "ui-state-unread" : "";
                      return (
                        <div
                          key={`${relation.requester_id}:${relation.addressee_id}`}
                          className={`home-friends-row relative flex items-center justify-between rounded-lg border border-transparent px-3 py-2 hover:border-white/10 hover:bg-white/[0.03] ${rowStateClass}`}
                        >
                          {hasMentionInUnread ? <span className="absolute bottom-1 left-0 top-1 w-1 rounded-r bg-[var(--state-mention-marker)]" /> : null}
                          {!hasMentionInUnread && unreadCount > 0 ? <span className="absolute bottom-1 left-0 top-1 w-1 rounded-r bg-[var(--state-unread-marker)]" /> : null}
                          <div className="flex min-w-0 items-center gap-2">
                            <Avatar src={peerAvatar} label={peerName} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-paw-text-secondary">{peerName}</p>
                              <p className="truncate text-xs text-paw-text-muted">{getPeerPresenceLabel(relation)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {hasMentionInUnread ? (
                              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--state-mention-marker)] px-1.5 text-[11px] font-bold leading-none text-[#1a1f22]">
                                @
                              </span>
                            ) : unreadCount > 0 ? (
                              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-paw-accent px-1.5 text-[11px] font-bold leading-none text-white">
                                {unreadLabel}
                              </span>
                            ) : null}
                            <p className="text-xs text-paw-text-muted">{new Date(relation.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </main>

            <aside className="home-tools-panel hidden w-[var(--layout-home-tools-width)] border-l border-black/35 bg-paw-bg-secondary p-4 xl:block">
              <section className="home-tools-card ui-surface p-4">
                <h4 className="typo-body mb-2 font-semibold text-paw-text-secondary">{t("home.tools_title")}</h4>

                <div className="home-tools-id-box mb-4 rounded-lg border border-white/10 bg-[var(--color-bg-tertiary)] p-2 text-xs">
                  <p className="typo-meta">{t("home.my_id")}</p>
                  <p className="typo-body mt-1 truncate text-paw-text-secondary">{effectiveUser?.id ?? t("common.none")}</p>
                  <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={() => void copyId()}>
                    {t("home.copy_id")}
                  </Button>
                </div>

                <form onSubmit={handleCreateServer} className="space-y-2">
                  <label className="typo-meta">{t("home.server_name_label")}</label>
                  <Input
                    value={serverName}
                    onChange={(event) => setServerName(event.target.value)}
                    placeholder={t("home.server_name_placeholder")}
                    className="h-9"
                  />
                  <Button type="submit" className="w-full" disabled={createServer.isPending || createChannel.isPending}>
                    {t("home.create_server_button")}
                  </Button>
                </form>

                <form onSubmit={handleJoinServer} className="mt-4 space-y-2">
                  <label className="typo-meta">{t("home.server_id_label")}</label>
                  <Input
                    value={joinServerId}
                    onChange={(event) => setJoinServerId(event.target.value)}
                    placeholder={t("home.server_invite_placeholder")}
                    className="h-9"
                  />
                  <Button type="submit" className="w-full" disabled={joinServer.isPending || joinServerByInvite.isPending}>
                    {t("home.join_server_button")}
                  </Button>
                </form>
              </section>
            </aside>
          </div>
        </section>
      )}
        </div>
      ) : null}

      {activeDmCall && !activeDmCallForSelectedChat ? (
        <div className="call-mini-player-surface ui-anim-fade-slide fixed bottom-6 right-6 z-[350] w-72 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Avatar src={activeDmCall.peerAvatar} label={activeDmCall.peerName} size="sm" online />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-paw-text-secondary">{activeDmCall.peerName}</p>
              <p className="truncate text-xs text-paw-text-muted">{activeDmCallStageLabel}</p>
            </div>
          </div>
          <div className="mb-2">{renderCallStatePills(true)}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={focusActiveCallChat}
              className="call-control-btn h-8 flex-1 rounded-md border-white/15 px-2 text-xs font-semibold"
              title="Ctrl+Shift+R"
            >
              {t("dm.call_return")}
            </button>
            <button
              type="button"
              onClick={endDirectCall}
              className="call-control-btn call-control-btn--danger h-8 rounded-md px-3 text-xs font-semibold"
            >
              {t("dm.call_end")}
            </button>
          </div>
        </div>
      ) : null}

      <audio ref={remoteCallAudioRef} autoPlay playsInline hidden />

      {incomingCallInvite ? (
        <div className="pointer-events-none fixed inset-0 z-[370]">
          <div
            ref={incomingCallPopupRef}
            className={`call-ring-popup call-ring-popup--centered pointer-events-auto relative w-[290px] overflow-hidden p-5 ${
              isIncomingCallPopupDragging ? "is-dragging" : ""
            }`}
            style={{ left: `${incomingCallPopupPosition.x}px`, top: `${incomingCallPopupPosition.y}px` }}
          >
            {incomingCallInvite.callerBanner ? (
              <img
                src={incomingCallInvite.callerBanner}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-20 blur-[1px]"
              />
            ) : null}
            <div className="dm-incoming-banner-overlay pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.38),rgba(0,0,0,0.82))]" />
            <div
              className="call-ring-popup-drag-area relative mb-5 flex flex-col items-center text-center"
              onPointerDown={handleIncomingCallPopupPointerDown}
              onPointerMove={handleIncomingCallPopupPointerMove}
              onPointerUp={handleIncomingCallPopupPointerEnd}
              onPointerCancel={handleIncomingCallPopupPointerEnd}
            >
              <Avatar src={incomingCallInvite.callerAvatar} label={incomingCallInvite.callerName} size="xl" />
              <p className="mt-3 max-w-full truncate text-xl font-semibold tracking-tight text-paw-text-primary">{incomingCallInvite.callerName}</p>
              <p className="mt-1 text-sm text-paw-text-muted">{t("dm.call_incoming")}</p>
            </div>
            <div className="relative flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={declineIncomingCall}
                className="call-control-btn call-control-btn--danger h-12 w-12"
                aria-label={t("dm.call_decline")}
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => void acceptIncomingCall()}
                className="call-control-btn call-control-btn--accept h-12 w-12"
                aria-label={t("dm.call_accept")}
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M6.9 3.5h3.6c.6 0 1.1.4 1.3 1l1 3.3c.2.7-.1 1.4-.7 1.7l-1.6.8c1 2 2.6 3.6 4.6 4.6l.8-1.6c.3-.6 1-.9 1.7-.7l3.3 1c.6.2 1 .7 1 1.3v3.6c0 .8-.6 1.4-1.4 1.5h-1.1C10.1 21 3 13.9 2 5.1V3.9C2 3.1 2.6 2.5 3.4 2.5h3.5Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
    </>
  );
};

export default HomePage;




