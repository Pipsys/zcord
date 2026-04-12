import { useCallback, useEffect, useRef, useState } from "react";

import { useAuthStore } from "@/store/authStore";
import { useChannelStore } from "@/store/channelStore";
import { useMessageStore } from "@/store/messageStore";
import { useServerStore } from "@/store/serverStore";
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

const DEFAULT_MESSAGE_SOUND_PATH = "sounds/message-receive.wav";
const MESSAGE_SOUND_VOLUME_RAW = Number(import.meta.env.VITE_MESSAGE_SOUND_VOLUME);
const MESSAGE_SOUND_VOLUME = Number.isFinite(MESSAGE_SOUND_VOLUME_RAW) ? Math.min(1, Math.max(0, MESSAGE_SOUND_VOLUME_RAW)) : 0.55;

const resolveMessageSoundUrl = (): string => {
  const configured = import.meta.env.VITE_MESSAGE_RECEIVE_SOUND_URL as string | undefined;
  const normalized = typeof configured === "string" && configured.trim().length > 0 ? configured.trim() : DEFAULT_MESSAGE_SOUND_PATH;

  if (typeof window === "undefined") {
    return normalized;
  }
  if (/^(https?:|file:|data:|blob:)/i.test(normalized)) {
    return normalized;
  }
  try {
    return new URL(normalized, window.location.href).toString();
  } catch {
    return normalized;
  }
};

export const useWebSocket = (): UseWebSocketResult => {
  const token = useAuthStore((state) => state.token);
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const knownChannels = useChannelStore((state) => state.channels);
  const knownServers = useServerStore((state) => state.servers);
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
  const messageAudioRef = useRef<HTMLAudioElement | null>(null);
  const messageAudioContextRef = useRef<AudioContext | null>(null);
  const failedMessageWavRef = useRef(false);
  const lastMessageSoundAtRef = useRef(0);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [status, setStatus] = useState<GatewayConnectionStatus>("offline");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  const playMessageTone = useCallback(() => {
    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    if (!messageAudioContextRef.current) {
      messageAudioContextRef.current = new AudioContextCtor();
    }
    const context = messageAudioContextRef.current;
    if (!context) {
      return;
    }
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }

    const notes = [820, 1040];
    const noteDuration = 0.065;
    const gapDuration = 0.025;
    const startAt = context.currentTime + 0.005;

    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = startAt + index * (noteDuration + gapDuration);
      const noteEnd = noteStart + noteDuration;

      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.045, noteStart + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.02);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  }, []);

  const getMessageAudioElement = useCallback((): HTMLAudioElement => {
    const existing = messageAudioRef.current;
    if (existing) {
      return existing;
    }

    const audio = new Audio(resolveMessageSoundUrl());
    audio.preload = "auto";
    audio.volume = MESSAGE_SOUND_VOLUME;
    audio.addEventListener("error", () => {
      failedMessageWavRef.current = true;
    });
    messageAudioRef.current = audio;
    return audio;
  }, []);

  const playMessageCue = useCallback(() => {
    const now = Date.now();
    if (now - lastMessageSoundAtRef.current < 80) {
      return;
    }
    lastMessageSoundAtRef.current = now;

    if (failedMessageWavRef.current) {
      playMessageTone();
      return;
    }

    const audio = getMessageAudioElement();
    audio.currentTime = 0;
    const playback = audio.play();
    if (playback && typeof playback.catch === "function") {
      void playback.catch(() => {
        failedMessageWavRef.current = true;
        playMessageTone();
      });
    }
  }, [getMessageAudioElement, playMessageTone]);

  const getNotificationTitle = useCallback(
    (message: Message): string => {
      if (typeof message.server_id === "string" && message.server_id.trim().length > 0) {
        const serverName =
          knownServers.find((server) => server.id === message.server_id)?.name ?? `server-${message.server_id.slice(0, 6)}`;
        const channelName =
          knownChannels.find((channel) => channel.id === message.channel_id)?.name ?? `channel-${message.channel_id.slice(0, 6)}`;
        return `${serverName} / #${channelName}`;
      }
      const channelName = knownChannels.find((channel) => channel.id === message.channel_id)?.name;
      if (channelName && channelName.startsWith("dm:")) {
        return "Direct messages";
      }
      if (channelName) {
        return `#${channelName}`;
      }
      return "New message";
    },
    [knownChannels, knownServers],
  );

  const getNotificationBody = useCallback((message: Message): string => {
    const normalizedAuthor = message.author_username?.trim();
    const author = normalizedAuthor && normalizedAuthor.length > 0 ? normalizedAuthor : `user-${message.author_id.slice(0, 6)}`;
    const normalizedContent = message.content.replace(/\s+/g, " ").trim();
    const preview = normalizedContent.length > 0 ? normalizedContent : "Attachment";
    return `${author}: ${preview.slice(0, 140)}`;
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      pruneTyping();
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [pruneTyping]);

  useEffect(() => {
    return () => {
      if (messageAudioRef.current) {
        messageAudioRef.current.pause();
        messageAudioRef.current.src = "";
        messageAudioRef.current = null;
      }
      failedMessageWavRef.current = false;
      if (messageAudioContextRef.current) {
        void messageAudioContextRef.current.close().catch(() => undefined);
        messageAudioContextRef.current = null;
      }
    };
  }, []);

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

      let meResponse: { ok: boolean } | null = null;
      let latestToken: string | null = null;
      try {
        meResponse = await window.pawcord.request<{ id: string }>({ method: "GET", path: "/users/me" });
        latestToken = await window.pawcord.auth.getToken();
      } catch {
        if (disposed) {
          return;
        }
        setStatus("reconnecting");
        reconnectTimer = window.setTimeout(() => {
          void connect();
        }, 1_500);
        return;
      }
      if (latestToken && latestToken !== token) {
        useAuthStore.getState().setToken(latestToken);
        return;
      }
      if (!meResponse?.ok && !latestToken) {
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

          if (message.author_id !== currentUserId) {
            playMessageCue();
            const shouldNotifyServerMessage = typeof message.server_id === "string" && message.server_id.trim().length > 0;
            if (shouldNotifyServerMessage) {
              void window.pawcord
                .notify(getNotificationTitle(message), getNotificationBody(message))
                .catch(() => undefined);
            }
          }

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
  }, [
    clearTyping,
    currentUserId,
    getNotificationBody,
    getNotificationTitle,
    deleteMessage,
    enqueueSignal,
    markDelivered,
    markRead,
    playMessageCue,
    removeParticipant,
    setParticipantsSnapshot,
    setTyping,
    token,
    updateParticipantState,
    upsertMessage,
    upsertParticipant,
  ]);

  return {
    socket,
    status,
    latencyMs,
  };
};
