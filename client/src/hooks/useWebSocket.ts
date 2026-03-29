import { useEffect, useRef, useState } from "react";

import { useAuthStore } from "@/store/authStore";
import { useMessageStore } from "@/store/messageStore";
import { useVoiceStore } from "@/store/voiceStore";
import type { GatewayEvent, Message } from "@/types";

interface ReceiptPayload {
  channel_id: string;
  message_id: string;
  user_id: string;
  at: string;
}

interface TypingPayload {
  channel_id: string;
  user_id: string;
  expires_at: string;
}

interface MessageDeletedPayload {
  message_id: string;
  channel_id: string;
  server_id: string | null;
  deleted_at: string;
}

interface VoiceParticipantPayload {
  user_id: string;
  channel_id: string;
  server_id: string | null;
  username: string | null;
  avatar_url: string | null;
  muted: boolean;
  deafened: boolean;
  screen_sharing: boolean;
}

interface VoiceSnapshotPayload {
  channel_id: string;
  participants: VoiceParticipantPayload[];
}

interface VoiceSignalPayload {
  channel_id: string;
  server_id: string | null;
  user_id: string;
  target_user_id: string | null;
  signal_type: "offer" | "answer" | "ice-candidate";
  payload: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const parseAttachments = (value: unknown): Message["attachments"] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item) => {
      const id = item.id;
      const filename = item.filename;
      const contentType = item.content_type;
      const sizeBytes = item.size_bytes;
      const downloadUrl = item.download_url;
      if (
        typeof id !== "string" ||
        typeof filename !== "string" ||
        typeof contentType !== "string" ||
        typeof sizeBytes !== "number" ||
        typeof downloadUrl !== "string"
      ) {
        return null;
      }
      return {
        id,
        filename,
        content_type: contentType,
        size_bytes: sizeBytes,
        width: typeof item.width === "number" ? item.width : null,
        height: typeof item.height === "number" ? item.height : null,
        download_url: downloadUrl,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
};

const parseMessagePayload = (value: unknown): Message | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = value.id;
  const channelId = value.channel_id;
  const authorId = value.author_id;
  const content = value.content;
  const createdAt = value.created_at;
  if (typeof id !== "string" || typeof channelId !== "string" || typeof authorId !== "string" || typeof content !== "string" || typeof createdAt !== "string") {
    return null;
  }

  return {
    id,
    channel_id: channelId,
    server_id: typeof value.server_id === "string" ? value.server_id : null,
    author_id: authorId,
    author_username: typeof value.author_username === "string" ? value.author_username : null,
    author_avatar_url: typeof value.author_avatar_url === "string" ? value.author_avatar_url : null,
    content,
    nonce: typeof value.nonce === "string" ? value.nonce : null,
    type: (value.type as Message["type"]) ?? "default",
    reference_id: typeof value.reference_id === "string" ? value.reference_id : null,
    edited_at: typeof value.edited_at === "string" ? value.edited_at : null,
    deleted_at: typeof value.deleted_at === "string" ? value.deleted_at : null,
    created_at: createdAt,
    delivered_at: typeof value.delivered_at === "string" ? value.delivered_at : null,
    read_at: typeof value.read_at === "string" ? value.read_at : null,
    delivered_by: Array.isArray(value.delivered_by) ? value.delivered_by.filter((item): item is string => typeof item === "string") : [],
    read_by: Array.isArray(value.read_by) ? value.read_by.filter((item): item is string => typeof item === "string") : [],
    attachments: parseAttachments(value.attachments),
  };
};

const parseReceiptPayload = (value: unknown): ReceiptPayload | null => {
  if (!isRecord(value)) {
    return null;
  }
  const channelId = value.channel_id;
  const messageId = value.message_id;
  const userId = value.user_id;
  const at = value.at;
  if (typeof channelId !== "string" || typeof messageId !== "string" || typeof userId !== "string" || typeof at !== "string") {
    return null;
  }
  return { channel_id: channelId, message_id: messageId, user_id: userId, at };
};

const parseTypingPayload = (value: unknown): TypingPayload | null => {
  if (!isRecord(value)) {
    return null;
  }
  const channelId = value.channel_id;
  const userId = value.user_id;
  const expiresAt = value.expires_at;
  if (typeof channelId !== "string" || typeof userId !== "string" || typeof expiresAt !== "string") {
    return null;
  }
  return { channel_id: channelId, user_id: userId, expires_at: expiresAt };
};

const parseMessageDeletedPayload = (value: unknown): MessageDeletedPayload | null => {
  if (!isRecord(value)) {
    return null;
  }
  const messageId = value.message_id;
  const channelId = value.channel_id;
  const deletedAt = value.deleted_at;
  if (typeof messageId !== "string" || typeof channelId !== "string" || typeof deletedAt !== "string") {
    return null;
  }
  return {
    message_id: messageId,
    channel_id: channelId,
    server_id: typeof value.server_id === "string" ? value.server_id : null,
    deleted_at: deletedAt,
  };
};

const parseVoiceParticipant = (value: unknown): VoiceParticipantPayload | null => {
  if (!isRecord(value)) {
    return null;
  }
  const userId = value.user_id;
  const channelId = value.channel_id;
  if (typeof userId !== "string" || typeof channelId !== "string") {
    return null;
  }

  return {
    user_id: userId,
    channel_id: channelId,
    server_id: typeof value.server_id === "string" ? value.server_id : null,
    username: typeof value.username === "string" ? value.username : null,
    avatar_url: typeof value.avatar_url === "string" ? value.avatar_url : null,
    muted: typeof value.muted === "boolean" ? value.muted : false,
    deafened: typeof value.deafened === "boolean" ? value.deafened : false,
    screen_sharing: typeof value.screen_sharing === "boolean" ? value.screen_sharing : false,
  };
};

const parseVoiceSnapshot = (value: unknown): VoiceSnapshotPayload | null => {
  if (!isRecord(value)) {
    return null;
  }
  const channelId = value.channel_id;
  const participants = value.participants;
  if (typeof channelId !== "string" || !Array.isArray(participants)) {
    return null;
  }

  const parsed = participants
    .map((participant) => parseVoiceParticipant(participant))
    .filter((item): item is VoiceParticipantPayload => item !== null)
    .map((participant) => ({ ...participant, channel_id: channelId }));

  return { channel_id: channelId, participants: parsed };
};

const parseVoiceSignal = (value: unknown): VoiceSignalPayload | null => {
  if (!isRecord(value)) {
    return null;
  }

  const channelId = value.channel_id;
  const userId = value.user_id;
  const signalType = value.signal_type;
  const signalPayload = value.payload;
  if (typeof channelId !== "string" || typeof userId !== "string") {
    return null;
  }
  if (signalType !== "offer" && signalType !== "answer" && signalType !== "ice-candidate") {
    return null;
  }
  if (!isRecord(signalPayload)) {
    return null;
  }

  return {
    channel_id: channelId,
    server_id: typeof value.server_id === "string" ? value.server_id : null,
    user_id: userId,
    target_user_id: typeof value.target_user_id === "string" ? value.target_user_id : null,
    signal_type: signalType,
    payload: signalPayload,
  };
};

const getWebSocketCandidates = (): string[] => {
  const configured = import.meta.env.VITE_WS_URL;
  const isDevMode = Boolean(import.meta.env.DEV);
  const candidates = [
    typeof configured === "string" ? configured.trim() : "",
    "wss://api.pawcord.ru/ws/gateway",
    ...(isDevMode ? [] : ["wss://pawcord.ru/ws/gateway", "wss://www.pawcord.ru/ws/gateway"]),
    "ws://localhost:8000/ws/gateway",
    "ws://127.0.0.1:8000/ws/gateway",
    "wss://localhost/ws/gateway",
  ].filter((item): item is string => typeof item === "string" && item.length > 0);

  return Array.from(new Set(candidates));
};

export type GatewayConnectionStatus = "offline" | "connecting" | "connected" | "reconnecting";

interface UseWebSocketResult {
  socket: WebSocket | null;
  status: GatewayConnectionStatus;
  latencyMs: number | null;
}

export const useWebSocket = (): UseWebSocketResult => {
  const token = useAuthStore((state) => state.token);
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const upsertMessage = useMessageStore((state) => state.upsertMessage);
  const deleteMessage = useMessageStore((state) => state.deleteMessage);
  const markDelivered = useMessageStore((state) => state.markDelivered);
  const markRead = useMessageStore((state) => state.markRead);
  const setTyping = useMessageStore((state) => state.setTyping);
  const clearTyping = useMessageStore((state) => state.clearTyping);
  const pruneTyping = useMessageStore((state) => state.pruneTyping);
  const setParticipantsSnapshot = useVoiceStore((state) => state.setParticipantsSnapshot);
  const upsertParticipant = useVoiceStore((state) => state.upsertParticipant);
  const removeParticipant = useVoiceStore((state) => state.removeParticipant);
  const updateParticipantState = useVoiceStore((state) => state.updateParticipantState);
  const enqueueSignal = useVoiceStore((state) => state.enqueueSignal);

  const deliveryAckedRef = useRef<Set<string>>(new Set());
  const heartbeatSentAtRef = useRef<number | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState<GatewayConnectionStatus>("offline");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      pruneTyping();
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [pruneTyping]);

  useEffect(() => {
    if (!token) {
      setSocket((current) => {
        current?.close();
        return null;
      });
      heartbeatSentAtRef.current = null;
      setLatencyMs(null);
      setStatus("offline");
      return;
    }

    deliveryAckedRef.current.clear();

    const candidates = getWebSocketCandidates();
    let candidateIndex = 0;
    let ws: WebSocket | null = null;
    let heartbeat: number | undefined;
    let reconnectTimer: number | undefined;
    let disposed = false;

    const clearHeartbeat = () => {
      if (heartbeat) {
        window.clearInterval(heartbeat);
        heartbeat = undefined;
      }
    };

    const clearReconnect = () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

    const connect = async () => {
      if (disposed || candidates.length === 0) {
        return;
      }

      clearReconnect();
      clearHeartbeat();
      setStatus(candidateIndex === 0 ? "connecting" : "reconnecting");

      const meResponse = await window.pawcord.request<{ id: string }>({ method: "GET", path: "/users/me" });
      const latestToken = await window.pawcord.auth.getToken();
      if (latestToken && latestToken !== token) {
        useAuthStore.getState().setToken(latestToken);
        return;
      }
      if (!meResponse.ok && !latestToken) {
        setSocket((current) => {
          current?.close();
          return null;
        });
        setStatus("offline");
        setLatencyMs(null);
        return;
      }

      const base = candidates[Math.min(candidateIndex, candidates.length - 1)];
      const next = new WebSocket(`${base}?token=${encodeURIComponent(token)}`);
      ws = next;
      setSocket(next);

      let opened = false;
      const sendHeartbeat = () => {
        if (next.readyState !== WebSocket.OPEN) {
          return;
        }
        heartbeatSentAtRef.current = Date.now();
        next.send(
          JSON.stringify({
            t: "HEARTBEAT",
            d: { sent_at: heartbeatSentAtRef.current },
          }),
        );
      };

      next.onopen = () => {
        opened = true;
        setStatus("connected");
        sendHeartbeat();
        heartbeat = window.setInterval(() => {
          sendHeartbeat();
        }, 15_000);
      };

      next.onmessage = (event) => {
        const payload = JSON.parse(event.data) as GatewayEvent;
        if (payload.t === "HEARTBEAT_ACK") {
          const sentAt = heartbeatSentAtRef.current;
          if (sentAt) {
            setLatencyMs(Math.max(1, Date.now() - sentAt));
            heartbeatSentAtRef.current = null;
          }
          return;
        }
        if (payload.t === "MESSAGE_CREATE") {
          const message = parseMessagePayload(payload.d);
          if (!message) {
            return;
          }
          upsertMessage(message.channel_id, message);
          clearTyping(message.channel_id, message.author_id);

          if (message.author_id !== currentUserId && !deliveryAckedRef.current.has(message.id) && next.readyState === WebSocket.OPEN) {
            deliveryAckedRef.current.add(message.id);
            next.send(
              JSON.stringify({
                t: "MESSAGE_DELIVERED_ACK",
                d: {
                  channel_id: message.channel_id,
                  server_id: message.server_id ?? null,
                  message_id: message.id,
                },
              }),
            );
          }
          return;
        }

        if (payload.t === "MESSAGE_UPDATE") {
          const message = parseMessagePayload(payload.d);
          if (!message) {
            return;
          }
          upsertMessage(message.channel_id, message);
          return;
        }

        if (payload.t === "MESSAGE_DELETE") {
          const deleted = parseMessageDeletedPayload(payload.d);
          if (!deleted) {
            return;
          }
          deleteMessage(deleted.channel_id, deleted.message_id);
          return;
        }

        if (payload.t === "MESSAGE_DELIVERED") {
          const receipt = parseReceiptPayload(payload.d);
          if (!receipt) {
            return;
          }
          markDelivered(receipt.message_id, receipt.user_id, receipt.at);
          return;
        }

        if (payload.t === "MESSAGE_READ") {
          const receipt = parseReceiptPayload(payload.d);
          if (!receipt) {
            return;
          }
          markRead(receipt.message_id, receipt.user_id, receipt.at);
          return;
        }

        if (payload.t === "TYPING_START") {
          const typing = parseTypingPayload(payload.d);
          if (!typing) {
            return;
          }
          if (typing.user_id !== currentUserId) {
            setTyping(typing.channel_id, typing.user_id, typing.expires_at);
          }
          return;
        }

        if (payload.t === "VOICE_PARTICIPANTS_SNAPSHOT") {
          const snapshot = parseVoiceSnapshot(payload.d);
          if (!snapshot) {
            return;
          }
          setParticipantsSnapshot(snapshot.channel_id, snapshot.participants);
          return;
        }

        if (payload.t === "VOICE_USER_JOINED") {
          const participant = parseVoiceParticipant(payload.d);
          if (!participant) {
            return;
          }
          upsertParticipant(participant.channel_id, participant);
          return;
        }

        if (payload.t === "VOICE_USER_LEFT") {
          const participant = parseVoiceParticipant(payload.d);
          if (!participant) {
            return;
          }
          removeParticipant(participant.channel_id, participant.user_id);
          return;
        }

        if (payload.t === "VOICE_STATE_UPDATE") {
          const participant = parseVoiceParticipant(payload.d);
          if (!participant) {
            return;
          }
          updateParticipantState(
            participant.channel_id,
            participant.user_id,
            participant.muted,
            participant.deafened,
            participant.screen_sharing,
            participant.username,
            participant.avatar_url,
          );
          return;
        }

        if (payload.t === "VOICE_SIGNAL") {
          const signal = parseVoiceSignal(payload.d);
          if (!signal) {
            return;
          }
          if (signal.user_id === currentUserId) {
            return;
          }
          enqueueSignal(signal);
        }
      };

      next.onclose = () => {
        clearHeartbeat();
        if (disposed) {
          return;
        }
        setStatus("reconnecting");
        heartbeatSentAtRef.current = null;

        if (!opened && candidateIndex < candidates.length - 1) {
          candidateIndex += 1;
          void connect();
          return;
        }

        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, 1_500);
      };
    };

    void connect();

    return () => {
      disposed = true;
      clearReconnect();
      clearHeartbeat();
      ws?.close();
      setSocket((current) => (current === ws ? null : current));
      heartbeatSentAtRef.current = null;
      setStatus("offline");
      setLatencyMs(null);
    };
  }, [clearTyping, currentUserId, deleteMessage, enqueueSignal, markDelivered, markRead, removeParticipant, setParticipantsSnapshot, setTyping, token, updateParticipantState, upsertMessage, upsertParticipant]);

  return {
    socket,
    status,
    latencyMs,
  };
};
