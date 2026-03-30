import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuthStore } from "@/store/authStore";
import { type VoiceParticipant, useVoiceStore } from "@/store/voiceStore";

export interface VoiceInputDevice {
  deviceId: string;
  label: string;
}

export interface ScreenShareSource {
  id: string;
  name: string;
  displayId: string;
  kind: "screen" | "window";
  thumbnailDataUrl: string | null;
  appIconDataUrl: string | null;
}

interface UseVoiceRoomResult {
  connectedChannelId: string | null;
  participants: VoiceParticipant[];
  localAudioStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  remoteScreenStreams: Record<string, MediaStream>;
  localScreenStream: MediaStream | null;
  screenShareFps: number | null;
  muted: boolean;
  deafened: boolean;
  screenSharing: boolean;
  volume: number;
  inputDevices: VoiceInputDevice[];
  selectedInputDeviceId: string;
  screenSources: ScreenShareSource[];
  selectedScreenSourceId: string;
  join: (channelId: string, serverId: string | null) => Promise<boolean>;
  leave: () => Promise<void>;
  toggleMuted: () => void;
  toggleDeafened: () => void;
  toggleScreenShare: (preferredSourceId?: string) => Promise<boolean>;
  setVolume: (value: number) => void;
  setInputDevice: (deviceId: string) => Promise<boolean>;
  refreshScreenSources: () => Promise<ScreenShareSource[]>;
  setScreenSource: (sourceId: string) => Promise<boolean>;
}

const buildIceServers = (): RTCIceServer[] => {
  const stunConfigured = import.meta.env.VITE_WEBRTC_STUN_URLS as string | undefined;
  const stunUrls =
    typeof stunConfigured === "string" && stunConfigured.trim().length > 0
      ? stunConfigured
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"];

  const servers: RTCIceServer[] = [{ urls: stunUrls }];

  const turnUrl = import.meta.env.VITE_WEBRTC_TURN_URL as string | undefined;
  const turnUsername = import.meta.env.VITE_WEBRTC_TURN_USERNAME as string | undefined;
  const turnCredential = import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL as string | undefined;
  const turnUrls =
    typeof turnUrl === "string" && turnUrl.trim().length > 0
      ? turnUrl
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

const ICE_SERVERS = buildIceServers();
const DEFAULT_INPUT_DEVICE_ID = "__system_default__";
const DEFAULT_SCREEN_SOURCE_ID = "__auto__";
const DISCONNECTED_CLOSE_DELAY_MS = 12_000;
const ICE_RESTART_MAX_ATTEMPTS = 2;
const SCREEN_SHARE_TARGET_FPS = 60;
const DEFAULT_JOIN_SOUND_PATH = "sounds/voice-join.wav";
const DEFAULT_LEAVE_SOUND_PATH = "sounds/voice-leave.wav";
const PRESENCE_SOUND_VOLUME_RAW = Number(import.meta.env.VITE_VOICE_PRESENCE_SOUND_VOLUME);
const PRESENCE_SOUND_VOLUME = Number.isFinite(PRESENCE_SOUND_VOLUME_RAW)
  ? Math.min(1, Math.max(0, PRESENCE_SOUND_VOLUME_RAW))
  : 0.5;

const resolvePresenceSoundUrl = (kind: "join" | "leave"): string => {
  const configured =
    kind === "join"
      ? (import.meta.env.VITE_VOICE_JOIN_SOUND_URL as string | undefined)
      : (import.meta.env.VITE_VOICE_LEAVE_SOUND_URL as string | undefined);
  const fallbackPath = kind === "join" ? DEFAULT_JOIN_SOUND_PATH : DEFAULT_LEAVE_SOUND_PATH;
  const normalized = typeof configured === "string" && configured.trim().length > 0 ? configured.trim() : fallbackPath;

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

const isMissingIpcHandlerError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("No handler registered for");
};

const stringifyVoicePayload = (payload: unknown): string => {
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
};

const voiceLog = (message: string, payload?: unknown): void => {
  if (typeof payload === "undefined") {
    console.info(`[voice] ${message}`);
    return;
  }
  console.info(`[voice] ${message} ${stringifyVoicePayload(payload)}`);
};

const voiceWarn = (message: string, payload?: unknown): void => {
  if (typeof payload === "undefined") {
    console.warn(`[voice] ${message}`);
    return;
  }
  console.warn(`[voice] ${message} ${stringifyVoicePayload(payload)}`);
};

const optimizeScreenTrackForStreaming = async (track: MediaStreamTrack): Promise<void> => {
  if (track.kind !== "video") {
    return;
  }

  track.contentHint = "motion";
  if (typeof track.applyConstraints !== "function") {
    return;
  }

  try {
    await track.applyConstraints({
      frameRate: {
        ideal: SCREEN_SHARE_TARGET_FPS,
        max: SCREEN_SHARE_TARGET_FPS,
      },
    });
  } catch {
    try {
      await track.applyConstraints({
        frameRate: {
          ideal: SCREEN_SHARE_TARGET_FPS,
          max: SCREEN_SHARE_TARGET_FPS,
        },
      });
    } catch {
      // Keep default browser-selected FPS if constraints are not supported.
    }
  }
};

const optimizeScreenVideoSender = async (sender: RTCRtpSender): Promise<void> => {
  try {
    const parameters = sender.getParameters();
    const nextEncodings = parameters.encodings && parameters.encodings.length > 0 ? [...parameters.encodings] : [{}];
    nextEncodings[0] = {
      ...nextEncodings[0],
      maxFramerate: SCREEN_SHARE_TARGET_FPS,
      scaleResolutionDownBy: 1,
    };
    parameters.encodings = nextEncodings;
    await sender.setParameters(parameters);
  } catch {
    // Not all WebRTC stacks support encoding tuning.
  }
};

interface ScreenShareSenders {
  video?: RTCRtpSender;
  audio?: RTCRtpSender;
}

export const useVoiceRoom = (socket: WebSocket | null): UseVoiceRoomResult => {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const connectedChannelId = useVoiceStore((state) => state.connectedChannelId);
  const participantsByChannel = useVoiceStore((state) => state.participantsByChannel);
  const signalsByChannel = useVoiceStore((state) => state.signalsByChannel);
  const setConnectedChannel = useVoiceStore((state) => state.setConnectedChannel);
  const consumeSignals = useVoiceStore((state) => state.consumeSignals);
  const removeParticipant = useVoiceStore((state) => state.removeParticipant);
  const clearChannel = useVoiceStore((state) => state.clearChannel);

  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Record<string, MediaStream>>({});
  const [localAudioStream, setLocalAudioStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [screenShareFps, setScreenShareFps] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [inputDevices, setInputDevices] = useState<VoiceInputDevice[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState(DEFAULT_INPUT_DEVICE_ID);
  const [screenSources, setScreenSources] = useState<ScreenShareSource[]>([]);
  const [selectedScreenSourceId, setSelectedScreenSourceId] = useState(DEFAULT_SCREEN_SOURCE_ID);

  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const localScreenTrackRef = useRef<MediaStreamTrack | null>(null);
  const localScreenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const peerMetaRef = useRef<Map<string, { channelId: string; serverId: string | null }>>(new Map());
  const screenSendersRef = useRef<Map<string, ScreenShareSenders>>(new Map());
  const disconnectTimersRef = useRef<Map<string, number>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const pendingInitialOffersChannelRef = useRef<string | null>(null);
  const screenShareStatsRef = useRef<Map<string, { timestamp: number; frames: number }>>(new Map());
  const screenShareStatsTimerRef = useRef<number | null>(null);
  const pendingRenegotiationsRef = useRef<Set<string>>(new Set());
  const pendingIceRestartRef = useRef<Set<string>>(new Set());
  const iceRestartAttemptsRef = useRef<Map<string, number>>(new Map());
  const iceRestartTimersRef = useRef<Map<string, number>>(new Map());
  const screenRecoveryAttemptsRef = useRef<Map<string, number>>(new Map());
  const connectedServerIdRef = useRef<string | null>(null);
  const connectedChannelIdRef = useRef<string | null>(null);
  const lastRejoinSocketRef = useRef<WebSocket | null>(null);
  const sendGatewayEventRef = useRef<(type: string, data: Record<string, unknown>) => boolean>(() => false);
  const presenceAudioContextRef = useRef<AudioContext | null>(null);
  const presenceAudioElementsRef = useRef<{ join: HTMLAudioElement | null; leave: HTMLAudioElement | null }>({
    join: null,
    leave: null,
  });
  const failedPresenceWavRef = useRef<{ join: boolean; leave: boolean }>({ join: false, leave: false });
  const previousRemoteParticipantIdsRef = useRef<Set<string>>(new Set());
  const presenceBaselineChannelRef = useRef<string | null>(null);

  const participants = useMemo(() => {
    if (!connectedChannelId) {
      return [];
    }
    return participantsByChannel[connectedChannelId] ?? [];
  }, [connectedChannelId, participantsByChannel]);

  const waitForSocketOpen = useCallback(async (targetSocket: WebSocket): Promise<boolean> => {
    if (targetSocket.readyState === WebSocket.OPEN) {
      return true;
    }
    if (targetSocket.readyState !== WebSocket.CONNECTING) {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      let timeoutHandle = 0;

      const cleanup = () => {
        targetSocket.removeEventListener("open", onOpen);
        targetSocket.removeEventListener("close", onClose);
        targetSocket.removeEventListener("error", onError);
        if (timeoutHandle) {
          window.clearTimeout(timeoutHandle);
        }
      };

      const finish = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };

      const onOpen = () => finish(true);
      const onClose = () => finish(false);
      const onError = () => finish(false);

      targetSocket.addEventListener("open", onOpen, { once: true });
      targetSocket.addEventListener("close", onClose, { once: true });
      targetSocket.addEventListener("error", onError, { once: true });

      timeoutHandle = window.setTimeout(() => {
        finish(targetSocket.readyState === WebSocket.OPEN);
      }, 4_000);
    });
  }, []);

  const sendGatewayEvent = useCallback(
    (type: string, data: Record<string, unknown>): boolean => {
      if (!socket) {
        if (type.startsWith("VOICE")) {
          voiceWarn("send skipped: no socket", { type, data });
        }
        return false;
      }
      if (socket.readyState !== WebSocket.OPEN) {
        if (type.startsWith("VOICE")) {
          voiceWarn("send skipped: socket not open", { type, readyState: socket.readyState, data });
        }
        return false;
      }

      socket.send(JSON.stringify({ t: type, d: data }));
      if (type.startsWith("VOICE")) {
        voiceLog("send", { type, data });
      }
      return true;
    },
    [socket],
  );

  const playPresenceTone = useCallback((kind: "join" | "leave"): void => {
    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    if (!presenceAudioContextRef.current) {
      presenceAudioContextRef.current = new AudioContextCtor();
    }
    const context = presenceAudioContextRef.current;
    if (!context) {
      return;
    }

    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }

    const notes = kind === "join" ? [740, 988] : [520, 392];
    const noteDuration = 0.07;
    const gapDuration = 0.03;
    const startAt = context.currentTime + 0.005;

    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = startAt + index * (noteDuration + gapDuration);
      const noteEnd = noteStart + noteDuration;

      oscillator.type = "triangle";
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.04, noteStart + 0.012);
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

  const getPresenceAudioElement = useCallback((kind: "join" | "leave"): HTMLAudioElement => {
    const existing = presenceAudioElementsRef.current[kind];
    if (existing) {
      return existing;
    }

    const audio = new Audio(resolvePresenceSoundUrl(kind));
    audio.preload = "auto";
    audio.volume = PRESENCE_SOUND_VOLUME;
    audio.addEventListener("error", () => {
      failedPresenceWavRef.current[kind] = true;
    });

    presenceAudioElementsRef.current[kind] = audio;
    return audio;
  }, []);

  const playPresenceCue = useCallback(
    (kind: "join" | "leave"): void => {
      if (failedPresenceWavRef.current[kind]) {
        playPresenceTone(kind);
        return;
      }

      const audio = getPresenceAudioElement(kind);
      audio.currentTime = 0;
      const playback = audio.play();
      if (playback && typeof playback.catch === "function") {
        void playback.catch(() => {
          failedPresenceWavRef.current[kind] = true;
          playPresenceTone(kind);
        });
      }
    },
    [getPresenceAudioElement, playPresenceTone],
  );

  useEffect(() => {
    connectedChannelIdRef.current = connectedChannelId;
  }, [connectedChannelId]);

  useEffect(() => {
    sendGatewayEventRef.current = sendGatewayEvent;
  }, [sendGatewayEvent]);

  useEffect(() => {
    if (!connectedChannelId) {
      previousRemoteParticipantIdsRef.current = new Set();
      presenceBaselineChannelRef.current = null;
      return;
    }

    const remoteIds = new Set(
      participants
        .filter((participant) => participant.user_id !== currentUserId)
        .map((participant) => participant.user_id),
    );

    if (presenceBaselineChannelRef.current !== connectedChannelId) {
      presenceBaselineChannelRef.current = connectedChannelId;
      previousRemoteParticipantIdsRef.current = remoteIds;
      return;
    }

    const previousRemoteIds = previousRemoteParticipantIdsRef.current;
    let joinedCount = 0;
    let leftCount = 0;

    for (const remoteId of remoteIds) {
      if (!previousRemoteIds.has(remoteId)) {
        joinedCount += 1;
      }
    }
    for (const remoteId of previousRemoteIds) {
      if (!remoteIds.has(remoteId)) {
        leftCount += 1;
      }
    }

    previousRemoteParticipantIdsRef.current = remoteIds;

    if (joinedCount > 0 && leftCount === 0) {
      playPresenceCue("join");
      return;
    }
    if (leftCount > 0 && joinedCount === 0) {
      playPresenceCue("leave");
    }
  }, [connectedChannelId, currentUserId, participants, playPresenceCue]);

  const buildAudioConstraints = useCallback((deviceId?: string): MediaTrackConstraints => {
    const constraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (deviceId && deviceId !== DEFAULT_INPUT_DEVICE_ID) {
      constraints.deviceId = { exact: deviceId };
    }
    return constraints;
  }, []);

  const requestLocalAudioStream = useCallback(
    async (preferredDeviceId: string): Promise<MediaStream> => {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: buildAudioConstraints(preferredDeviceId),
        });
      } catch (error) {
        if (preferredDeviceId === DEFAULT_INPUT_DEVICE_ID) {
          throw error;
        }

        const fallback = await navigator.mediaDevices.getUserMedia({
          audio: buildAudioConstraints(DEFAULT_INPUT_DEVICE_ID),
        });
        setSelectedInputDeviceId(DEFAULT_INPUT_DEVICE_ID);
        return fallback;
      }
    },
    [buildAudioConstraints],
  );

  const refreshInputDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === "audioinput");
      const nextDevices: VoiceInputDevice[] = [{ deviceId: DEFAULT_INPUT_DEVICE_ID, label: "Default microphone" }];
      const seenDeviceIds = new Set<string>([DEFAULT_INPUT_DEVICE_ID]);

      let generatedIndex = 1;
      for (const device of audioInputs) {
        const deviceId = typeof device.deviceId === "string" ? device.deviceId : "";
        if (!deviceId || seenDeviceIds.has(deviceId)) {
          continue;
        }
        seenDeviceIds.add(deviceId);
        nextDevices.push({
          deviceId,
          label: device.label && device.label.trim().length > 0 ? device.label : `Microphone ${generatedIndex}`,
        });
        generatedIndex += 1;
      }

      setInputDevices(nextDevices);
      const hasSelected = nextDevices.some((device) => device.deviceId === selectedInputDeviceId);
      if (!hasSelected) {
        setSelectedInputDeviceId(DEFAULT_INPUT_DEVICE_ID);
      }
    } catch {
      // Device enumeration may fail before media permissions are granted.
    }
  }, [selectedInputDeviceId]);

  const refreshScreenSources = useCallback(async (): Promise<ScreenShareSource[]> => {
    if (!window.pawcord?.media?.listScreenSources) {
      setScreenSources([]);
      setSelectedScreenSourceId(DEFAULT_SCREEN_SOURCE_ID);
      return [];
    }

    try {
      const sources = await window.pawcord.media.listScreenSources();
      const normalized = sources
        .filter((source) => typeof source.id === "string" && source.id.trim().length > 0)
        .map((source) => ({
          id: source.id,
          name: source.name,
          displayId: source.displayId,
          kind: source.kind,
          thumbnailDataUrl: source.thumbnailDataUrl,
          appIconDataUrl: source.appIconDataUrl,
        }));

      setScreenSources(normalized);
      if (selectedScreenSourceId !== DEFAULT_SCREEN_SOURCE_ID) {
        const selectedExists = normalized.some((source) => source.id === selectedScreenSourceId);
        if (!selectedExists) {
          setSelectedScreenSourceId(DEFAULT_SCREEN_SOURCE_ID);
        }
      }
      return normalized;
    } catch (error) {
      if (isMissingIpcHandlerError(error)) {
        // Fallback mode: the main process doesn't expose screen source IPC yet.
        voiceWarn("screen source listing skipped: ipc handler is missing");
        return [];
      }
      setScreenSources([]);
      setSelectedScreenSourceId(DEFAULT_SCREEN_SOURCE_ID);
      return [];
    }
  }, [selectedScreenSourceId]);

  const setScreenSource = useCallback(async (sourceId: string): Promise<boolean> => {
    const normalized = typeof sourceId === "string" && sourceId.trim().length > 0 ? sourceId.trim() : DEFAULT_SCREEN_SOURCE_ID;
    setSelectedScreenSourceId(normalized);

    if (!window.pawcord?.media?.selectScreenSource) {
      return true;
    }

    try {
      await window.pawcord.media.selectScreenSource(normalized === DEFAULT_SCREEN_SOURCE_ID ? null : normalized);
      return true;
    } catch (error) {
      if (isMissingIpcHandlerError(error)) {
        // Fallback mode: proceed with native getDisplayMedia picker.
        voiceWarn("screen source selection skipped: ipc handler is missing", { sourceId: normalized });
        return true;
      }
      return false;
    }
  }, []);
  const waitForParticipantsSnapshot = useCallback(async (channelId: string): Promise<boolean> => {
    const startedAt = Date.now();
    const timeoutMs = 4_000;
    while (Date.now() - startedAt < timeoutMs) {
      const snapshot = useVoiceStore.getState().participantsByChannel[channelId];
      if (Array.isArray(snapshot)) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return false;
  }, []);

  const stopLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalAudioStream(null);
  }, []);

  const clearLocalScreenState = useCallback((stopTracks: boolean) => {
    const currentTrack = localScreenTrackRef.current;
    if (currentTrack) {
      currentTrack.onended = null;
      if (stopTracks) {
        currentTrack.stop();
      }
    }

    const currentStream = localScreenStreamRef.current;
    if (currentStream && stopTracks) {
      currentStream.getTracks().forEach((track) => {
        if (track !== currentTrack) {
          track.stop();
        }
      });
    }

    localScreenTrackRef.current = null;
    localScreenAudioTrackRef.current = null;
    localScreenStreamRef.current = null;
    setScreenSharing(false);
    setLocalScreenStream(null);
  }, []);

  const closePeer = useCallback((remoteUserId: string) => {
    const disconnectTimer = disconnectTimersRef.current.get(remoteUserId);
    if (disconnectTimer) {
      window.clearTimeout(disconnectTimer);
      disconnectTimersRef.current.delete(remoteUserId);
    }
    const iceRestartTimer = iceRestartTimersRef.current.get(remoteUserId);
    if (iceRestartTimer) {
      window.clearTimeout(iceRestartTimer);
      iceRestartTimersRef.current.delete(remoteUserId);
    }

    const peer = peersRef.current.get(remoteUserId);
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.onsignalingstatechange = null;
      peer.close();
      peersRef.current.delete(remoteUserId);
    }
    peerMetaRef.current.delete(remoteUserId);
    screenSendersRef.current.delete(remoteUserId);
    pendingCandidatesRef.current.delete(remoteUserId);
    pendingRenegotiationsRef.current.delete(remoteUserId);
    pendingIceRestartRef.current.delete(remoteUserId);
    iceRestartAttemptsRef.current.delete(remoteUserId);
    screenRecoveryAttemptsRef.current.delete(remoteUserId);
    setRemoteStreams((current) => {
      const next = { ...current };
      delete next[remoteUserId];
      return next;
    });
    setRemoteScreenStreams((current) => {
      const next = { ...current };
      delete next[remoteUserId];
      return next;
    });
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const timer of disconnectTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    disconnectTimersRef.current.clear();

    const userIds = Array.from(peersRef.current.keys());
    for (const remoteUserId of userIds) {
      closePeer(remoteUserId);
    }
  }, [closePeer]);

  const renegotiatePeer = useCallback(
    async (remoteUserId: string, options?: { iceRestart?: boolean; reason?: string }): Promise<void> => {
      const peer = peersRef.current.get(remoteUserId);
      const meta = peerMetaRef.current.get(remoteUserId);
      if (!peer || !meta) {
        return;
      }
      const shouldIceRestart = Boolean(options?.iceRestart || pendingIceRestartRef.current.has(remoteUserId));
      if (peer.signalingState !== "stable") {
        pendingRenegotiationsRef.current.add(remoteUserId);
        if (shouldIceRestart) {
          pendingIceRestartRef.current.add(remoteUserId);
        }
        voiceWarn("skip renegotiation: signaling state is not stable", {
          remoteUserId,
          state: peer.signalingState,
          iceRestart: shouldIceRestart,
        });
        return;
      }
      pendingRenegotiationsRef.current.delete(remoteUserId);
      pendingIceRestartRef.current.delete(remoteUserId);

      try {
        const offer = await peer.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
          iceRestart: shouldIceRestart,
        });
        await peer.setLocalDescription(offer);
        voiceLog("sending offer", {
          remoteUserId,
          channelId: meta.channelId,
          serverId: meta.serverId,
          iceRestart: shouldIceRestart,
          reason: options?.reason ?? null,
        });
        sendGatewayEvent("VOICE_SIGNAL", {
          channel_id: meta.channelId,
          server_id: meta.serverId,
          target_user_id: remoteUserId,
          signal_type: "offer",
          payload: offer,
        });
      } catch {
        closePeer(remoteUserId);
      }
    },
    [closePeer, sendGatewayEvent],
  );

  const scheduleIceRestart = useCallback(
    (remoteUserId: string, reason: string): boolean => {
      const peer = peersRef.current.get(remoteUserId);
      if (!peer || peer.connectionState === "closed" || peer.signalingState === "closed") {
        return false;
      }
      if (iceRestartTimersRef.current.has(remoteUserId)) {
        return true;
      }

      const attempts = iceRestartAttemptsRef.current.get(remoteUserId) ?? 0;
      if (attempts >= ICE_RESTART_MAX_ATTEMPTS) {
        voiceWarn("ice restart attempts exhausted", { remoteUserId, reason, attempts });
        return false;
      }

      const nextAttempt = attempts + 1;
      iceRestartAttemptsRef.current.set(remoteUserId, nextAttempt);
      const delayMs = 250 * nextAttempt;
      voiceWarn("scheduling ice restart", { remoteUserId, reason, attempt: nextAttempt, delayMs });

      const timer = window.setTimeout(() => {
        iceRestartTimersRef.current.delete(remoteUserId);
        void renegotiatePeer(remoteUserId, { iceRestart: true, reason });
      }, delayMs);
      iceRestartTimersRef.current.set(remoteUserId, timer);
      return true;
    },
    [renegotiatePeer],
  );

  const stopScreenShare = useCallback(async (): Promise<boolean> => {
    const hasScreenTrack = Boolean(localScreenTrackRef.current);
    const hasScreenAudioTrack = Boolean(localScreenAudioTrackRef.current);
    if (!hasScreenTrack && !hasScreenAudioTrack && screenSendersRef.current.size === 0) {
      clearLocalScreenState(true);
      return false;
    }

    const renegotiateTargets: string[] = [];
    for (const [remoteUserId, peer] of peersRef.current.entries()) {
      const senders = screenSendersRef.current.get(remoteUserId);
      if (!senders) {
        continue;
      }

      for (const sender of [senders.video, senders.audio]) {
        if (!sender) {
          continue;
        }
        try {
          peer.removeTrack(sender);
        } catch {
          // Ignore if sender is already detached.
        }
      }

      screenSendersRef.current.delete(remoteUserId);
      renegotiateTargets.push(remoteUserId);
    }

    clearLocalScreenState(true);
    const channelId = connectedChannelIdRef.current;
    if (channelId) {
      sendGatewayEventRef.current("VOICE_STATE_UPDATE", {
        channel_id: channelId,
        server_id: connectedServerIdRef.current,
        muted,
        deafened,
        screen_sharing: false,
      });
    }

    for (const remoteUserId of renegotiateTargets) {
      await renegotiatePeer(remoteUserId);
    }
    return true;
  }, [clearLocalScreenState, deafened, muted, renegotiatePeer]);

  useEffect(() => {
    void refreshInputDevices();
    void refreshScreenSources();

    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices || typeof mediaDevices.addEventListener !== "function") {
      return;
    }

    const handleDeviceChange = () => {
      void refreshInputDevices();
    };

    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshInputDevices, refreshScreenSources]);

  const flushPendingCandidates = useCallback(async (remoteUserId: string, peer: RTCPeerConnection) => {
    const queued = pendingCandidatesRef.current.get(remoteUserId);
    if (!queued || queued.length === 0) {
      return;
    }

    pendingCandidatesRef.current.delete(remoteUserId);
    for (const candidate of queued) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore malformed candidates.
      }
    }
  }, []);

  const createPeerConnection = useCallback(
    (remoteUserId: string, channelId: string, serverId: string | null): RTCPeerConnection => {
      const existing = peersRef.current.get(remoteUserId);
      if (existing) {
        const existingState = existing.connectionState;
        const existingSignalingState = existing.signalingState;
        if (
          existingState === "failed" ||
          existingState === "disconnected" ||
          existingState === "closed" ||
          existingSignalingState === "closed"
        ) {
          closePeer(remoteUserId);
        } else {
          return existing;
        }
      }

      voiceLog("creating peer", {
        remoteUserId,
        channelId,
        serverId,
        iceServers: ICE_SERVERS,
      });
      const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peerMetaRef.current.set(remoteUserId, { channelId, serverId });

      const localStream = localStreamRef.current;
      if (localStream) {
        for (const track of localStream.getTracks()) {
          peer.addTrack(track, localStream);
        }
      }

      const screenTrack = localScreenTrackRef.current;
      const screenAudioTrack = localScreenAudioTrackRef.current;
      const screenStream = localScreenStreamRef.current;
      if (screenTrack && screenStream) {
        const senders: ScreenShareSenders = {};
        try {
          senders.video = peer.addTrack(screenTrack, screenStream);
          if (senders.video) {
            void optimizeScreenVideoSender(senders.video);
          }
        } catch (error) {
          voiceWarn("failed to attach screen video track to peer", {
            remoteUserId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (screenAudioTrack && screenAudioTrack.readyState === "live") {
          try {
            senders.audio = peer.addTrack(screenAudioTrack, screenStream);
          } catch (error) {
            voiceWarn("failed to attach screen audio track to peer", {
              remoteUserId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (senders.video || senders.audio) {
          screenSendersRef.current.set(remoteUserId, senders);
        }
      }

      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        sendGatewayEvent("VOICE_SIGNAL", {
          channel_id: channelId,
          server_id: serverId,
          target_user_id: remoteUserId,
          signal_type: "ice-candidate",
          payload: event.candidate.toJSON(),
        });
      };

      peer.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        if (event.track.kind === "video") {
          voiceLog("remote screen track received", {
            remoteUserId,
            trackId: event.track.id,
            streamId: stream.id,
          });
          setRemoteScreenStreams((current) => ({ ...current, [remoteUserId]: stream }));
          event.track.addEventListener("ended", () => {
            setRemoteScreenStreams((current) => {
              const existing = current[remoteUserId];
              if (!existing) {
                return current;
              }

              const existingVideoTracks = existing.getVideoTracks();
              const containsEndedTrack = existingVideoTracks.some((track) => track.id === event.track.id);
              if (!containsEndedTrack) {
                // A newer renegotiation already replaced this track.
                return current;
              }

              const remainingTracks = existing.getTracks().filter((track) => track.id !== event.track.id);
              const hasLiveVideoTrack = remainingTracks.some((track) => track.kind === "video" && track.readyState === "live");
              if (!hasLiveVideoTrack) {
                const next = { ...current };
                delete next[remoteUserId];
                return next;
              }

              return {
                ...current,
                [remoteUserId]: new MediaStream(remainingTracks),
              };
            });
          });
          return;
        }
        voiceLog("remote audio track received", {
          remoteUserId,
          trackId: event.track.id,
          streamId: stream.id,
        });
        setRemoteStreams((current) => {
          const existing = current[remoteUserId];
          const mergedStream = existing ?? new MediaStream();
          const alreadyAdded = mergedStream.getAudioTracks().some((track) => track.id === event.track.id);
          if (!alreadyAdded) {
            mergedStream.addTrack(event.track);
          }
          return { ...current, [remoteUserId]: mergedStream };
        });
        event.track.addEventListener("ended", () => {
          setRemoteStreams((current) => {
            const existing = current[remoteUserId];
            if (!existing) {
              return current;
            }
            const nextStream = new MediaStream(
              existing.getAudioTracks().filter((track) => track.id !== event.track.id),
            );
            if (nextStream.getAudioTracks().length === 0) {
              const next = { ...current };
              delete next[remoteUserId];
              return next;
            }
            return { ...current, [remoteUserId]: nextStream };
          });
        });
      };

      peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        voiceLog("peer connection state", { remoteUserId, state });

        if (state === "connected" || state === "connecting") {
          const timer = disconnectTimersRef.current.get(remoteUserId);
          if (timer) {
            window.clearTimeout(timer);
            disconnectTimersRef.current.delete(remoteUserId);
          }
          const restartTimer = iceRestartTimersRef.current.get(remoteUserId);
          if (restartTimer) {
            window.clearTimeout(restartTimer);
            iceRestartTimersRef.current.delete(remoteUserId);
          }
          iceRestartAttemptsRef.current.delete(remoteUserId);
          pendingIceRestartRef.current.delete(remoteUserId);
          return;
        }

        if (state === "disconnected") {
          void scheduleIceRestart(remoteUserId, "connection-disconnected");
          if (!disconnectTimersRef.current.has(remoteUserId)) {
            const timer = window.setTimeout(() => {
              const currentPeer = peersRef.current.get(remoteUserId);
              if (!currentPeer) {
                return;
              }
              if (currentPeer.connectionState === "disconnected") {
                voiceWarn("closing disconnected peer after timeout", { remoteUserId });
                closePeer(remoteUserId);
              }
            }, DISCONNECTED_CLOSE_DELAY_MS);
            disconnectTimersRef.current.set(remoteUserId, timer);
          }
          return;
        }

        if (state === "failed") {
          const scheduled = scheduleIceRestart(remoteUserId, "connection-failed");
          if (!scheduled) {
            closePeer(remoteUserId);
          }
          return;
        }

        if (state === "closed") {
          closePeer(remoteUserId);
        }
      };
      peer.onsignalingstatechange = () => {
        const state = peer.signalingState;
        voiceLog("peer signaling state", { remoteUserId, state });
        if (state !== "stable") {
          return;
        }
        if (!pendingRenegotiationsRef.current.has(remoteUserId)) {
          return;
        }
        const shouldIceRestart = pendingIceRestartRef.current.has(remoteUserId);
        pendingRenegotiationsRef.current.delete(remoteUserId);
        void renegotiatePeer(remoteUserId, {
          iceRestart: shouldIceRestart,
          reason: "signaling-stable",
        });
      };

      peersRef.current.set(remoteUserId, peer);
      return peer;
    },
    [closePeer, renegotiatePeer, scheduleIceRestart, sendGatewayEvent],
  );

  const join = useCallback(
    async (channelId: string, serverId: string | null): Promise<boolean> => {
      if (!socket) {
        return false;
      }

      const socketReady = await waitForSocketOpen(socket);
      if (!socketReady) {
        return false;
      }

      if (connectedChannelId && connectedChannelId !== channelId) {
        sendGatewayEvent("VOICE_LEAVE", {
          channel_id: connectedChannelId,
          server_id: serverId,
        });
        playPresenceCue("leave");
        if (currentUserId) {
          removeParticipant(connectedChannelId, currentUserId);
        } else {
          clearChannel(connectedChannelId);
        }
        clearLocalScreenState(true);
        screenSendersRef.current.clear();
        setRemoteScreenStreams({});
      }

      try {
        if (!localStreamRef.current) {
          const stream = await requestLocalAudioStream(selectedInputDeviceId);
          stream.getAudioTracks().forEach((track) => {
            track.enabled = !muted;
          });
          localStreamRef.current = stream;
          setLocalAudioStream(stream);
          await refreshInputDevices();
        }
      } catch {
        return false;
      }

      closeAllPeers();
      setRemoteStreams({});
      pendingInitialOffersChannelRef.current = channelId;
      connectedServerIdRef.current = serverId;
      lastRejoinSocketRef.current = null;
      setConnectedChannel(channelId);

      sendGatewayEvent("VOICE_JOIN", {
        channel_id: channelId,
        server_id: serverId,
      });

      sendGatewayEvent("VOICE_STATE_UPDATE", {
        channel_id: channelId,
        server_id: serverId,
        muted,
        deafened,
        screen_sharing: Boolean(localScreenTrackRef.current),
      });

      const hasSnapshot = await waitForParticipantsSnapshot(channelId);
      if (!hasSnapshot) {
        voiceWarn("participants snapshot timeout", { channelId });
        pendingInitialOffersChannelRef.current = null;
        connectedServerIdRef.current = null;
        lastRejoinSocketRef.current = null;
        stopLocalStream();
        clearLocalScreenState(true);
        screenSendersRef.current.clear();
        closeAllPeers();
        setRemoteStreams({});
        setRemoteScreenStreams({});
        clearChannel(channelId);
        setConnectedChannel(null);
        return false;
      }

      playPresenceCue("join");
      voiceLog("join completed", { channelId, serverId, participantsCount: useVoiceStore.getState().participantsByChannel[channelId]?.length ?? 0 });
      return true;
    },
    [
      clearChannel,
      closeAllPeers,
      clearLocalScreenState,
      connectedChannelId,
      currentUserId,
      deafened,
      muted,
      removeParticipant,
      refreshInputDevices,
      requestLocalAudioStream,
      selectedInputDeviceId,
      sendGatewayEvent,
      setConnectedChannel,
      socket,
      stopLocalStream,
      playPresenceCue,
      waitForParticipantsSnapshot,
      waitForSocketOpen,
    ],
  );

  const leave = useCallback(async () => {
    const channelId = connectedChannelId;
    if (channelId) {
      sendGatewayEvent("VOICE_LEAVE", { channel_id: channelId });
      playPresenceCue("leave");
      if (currentUserId) {
        removeParticipant(channelId, currentUserId);
      } else {
        clearChannel(channelId);
      }
    }

    pendingInitialOffersChannelRef.current = null;
    connectedServerIdRef.current = null;
    lastRejoinSocketRef.current = null;
    stopLocalStream();
    clearLocalScreenState(true);
    screenSendersRef.current.clear();
    closeAllPeers();
    setRemoteStreams({});
    setRemoteScreenStreams({});
    setConnectedChannel(null);
  }, [
    clearChannel,
    clearLocalScreenState,
    closeAllPeers,
    connectedChannelId,
    currentUserId,
    removeParticipant,
    sendGatewayEvent,
    setConnectedChannel,
    stopLocalStream,
    playPresenceCue,
  ]);

  const toggleMuted = useCallback(() => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });

    if (connectedChannelId) {
      sendGatewayEvent("VOICE_STATE_UPDATE", {
        channel_id: connectedChannelId,
        muted: nextMuted,
        deafened,
        screen_sharing: Boolean(localScreenTrackRef.current),
      });
    }
  }, [connectedChannelId, deafened, muted, sendGatewayEvent]);

  const toggleDeafened = useCallback(() => {
    const nextDeafened = !deafened;
    setDeafened(nextDeafened);
    if (connectedChannelId) {
      sendGatewayEvent("VOICE_STATE_UPDATE", {
        channel_id: connectedChannelId,
        muted,
        deafened: nextDeafened,
        screen_sharing: Boolean(localScreenTrackRef.current),
      });
    }
  }, [connectedChannelId, deafened, muted, sendGatewayEvent]);

  const toggleScreenShare = useCallback(async (preferredSourceId?: string): Promise<boolean> => {
    if (!connectedChannelIdRef.current) {
      return false;
    }

    if (localScreenTrackRef.current) {
      return await stopScreenShare();
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") {
      voiceWarn("screen share is not supported in this environment");
      return false;
    }

    const availableSources = await refreshScreenSources();
    const normalizedPreferredSourceId =
      typeof preferredSourceId === "string" && preferredSourceId.trim().length > 0
        ? preferredSourceId.trim()
        : selectedScreenSourceId;
    const resolvedPreferredSourceId =
      normalizedPreferredSourceId !== DEFAULT_SCREEN_SOURCE_ID && availableSources.some((source) => source.id === normalizedPreferredSourceId)
        ? normalizedPreferredSourceId
        : DEFAULT_SCREEN_SOURCE_ID;

    const selected = await setScreenSource(resolvedPreferredSourceId);
    if (!selected) {
      voiceWarn("screen share source selection failed", { sourceId: resolvedPreferredSourceId });
      return false;
    }

    const captureAttempts: DisplayMediaStreamOptions[] = [
      {
        video: {
          frameRate: {
            ideal: SCREEN_SHARE_TARGET_FPS,
            max: SCREEN_SHARE_TARGET_FPS,
          },
        },
        audio: true,
      },
      {
        video: true,
        audio: true,
      },
      {
        video: true,
        audio: false,
      },
    ];
    let screenStream: MediaStream | null = null;
    let lastError: unknown = null;

    for (const constraints of captureAttempts) {
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
        break;
      } catch (error) {
        lastError = error;
        voiceWarn("screen share start attempt failed", {
          error: error instanceof Error ? error.message : String(error),
          constraints,
          sourceId: resolvedPreferredSourceId,
        });
      }
    }

    if (!screenStream && resolvedPreferredSourceId !== DEFAULT_SCREEN_SOURCE_ID) {
      const fallbackSelected = await setScreenSource(DEFAULT_SCREEN_SOURCE_ID);
      if (fallbackSelected) {
        for (const constraints of captureAttempts) {
          try {
            screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
            break;
          } catch (error) {
            lastError = error;
            voiceWarn("screen share fallback attempt failed", {
              error: error instanceof Error ? error.message : String(error),
              constraints,
              sourceId: DEFAULT_SCREEN_SOURCE_ID,
            });
          }
        }
      }
    }

    if (!screenStream) {
      voiceWarn("screen share start failed", {
        error: lastError instanceof Error ? lastError.message : String(lastError),
      });
      return false;
    }

    const screenTrack = screenStream.getVideoTracks()[0];
    if (!screenTrack) {
      screenStream.getTracks().forEach((track) => track.stop());
      voiceWarn("screen share start failed: no video track");
      return false;
    }
    await optimizeScreenTrackForStreaming(screenTrack);
    const screenAudioTrack = screenStream.getAudioTracks()[0] ?? null;
    if (screenAudioTrack) {
      voiceLog("screen share captured system audio track", {
        trackId: screenAudioTrack.id,
        sourceId: resolvedPreferredSourceId,
      });
    } else {
      voiceWarn("screen share started without system audio track", { sourceId: resolvedPreferredSourceId });
    }

    localScreenStreamRef.current = screenStream;
    localScreenTrackRef.current = screenTrack;
    localScreenAudioTrackRef.current = screenAudioTrack;
    setScreenSharing(true);
    setLocalScreenStream(screenStream);
    sendGatewayEvent("VOICE_STATE_UPDATE", {
      channel_id: connectedChannelIdRef.current,
      server_id: connectedServerIdRef.current,
      muted,
      deafened,
      screen_sharing: true,
    });

    screenTrack.onended = () => {
      void stopScreenShare();
    };
    if (screenAudioTrack) {
      screenAudioTrack.onended = () => {
        if (localScreenAudioTrackRef.current?.id === screenAudioTrack.id) {
          localScreenAudioTrackRef.current = null;
        }
      };
    }

    for (const [remoteUserId, peer] of peersRef.current.entries()) {
      let videoSender: RTCRtpSender | undefined;
      try {
        videoSender = peer.addTrack(screenTrack, screenStream);
        if (videoSender) {
          await optimizeScreenVideoSender(videoSender);
        }
      } catch (error) {
        voiceWarn("failed to add screen video track", {
          remoteUserId,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const senders: ScreenShareSenders = { video: videoSender };
      if (screenAudioTrack && screenAudioTrack.readyState === "live") {
        try {
          senders.audio = peer.addTrack(screenAudioTrack, screenStream);
        } catch (error) {
          voiceWarn("failed to add screen audio track", {
            remoteUserId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      screenSendersRef.current.set(remoteUserId, senders);
      await renegotiatePeer(remoteUserId);
    }

    return true;
  }, [refreshScreenSources, renegotiatePeer, selectedScreenSourceId, setScreenSource, stopScreenShare]);

  useEffect(() => {
    if (!screenSharing || !localScreenTrackRef.current) {
      if (screenShareStatsTimerRef.current !== null) {
        window.clearInterval(screenShareStatsTimerRef.current);
        screenShareStatsTimerRef.current = null;
      }
      screenShareStatsRef.current.clear();
      setScreenShareFps(null);
      return;
    }

    let disposed = false;

    const collectScreenShareFps = async () => {
      const senderEntries = Array.from(screenSendersRef.current.entries())
        .map(([remoteUserId, senders]) => ({ remoteUserId, sender: senders.video }))
        .filter((entry): entry is { remoteUserId: string; sender: RTCRtpSender } => Boolean(entry.sender));

      if (senderEntries.length === 0) {
        if (!disposed) {
          setScreenShareFps(null);
        }
        return;
      }

      const fpsValues: number[] = [];

      for (const { remoteUserId, sender } of senderEntries) {
        try {
          const stats = await sender.getStats();
          let bestSenderFps = 0;

          for (const report of stats.values()) {
            if (report.type !== "outbound-rtp") {
              continue;
            }
            const mediaKind = (report as RTCOutboundRtpStreamStats & { mediaType?: string }).kind ?? (report as { mediaType?: string }).mediaType;
            if (mediaKind !== "video") {
              continue;
            }

            const fpsFromReport = (report as RTCOutboundRtpStreamStats & { framesPerSecond?: number }).framesPerSecond;
            if (typeof fpsFromReport === "number" && Number.isFinite(fpsFromReport) && fpsFromReport > 0) {
              bestSenderFps = Math.max(bestSenderFps, fpsFromReport);
            }

            const framesNowRaw =
              (report as RTCOutboundRtpStreamStats & { framesEncoded?: number }).framesEncoded ??
              (report as RTCOutboundRtpStreamStats & { framesSent?: number }).framesSent;
            if (typeof framesNowRaw !== "number" || !Number.isFinite(framesNowRaw)) {
              continue;
            }

            const sampleKey = `${remoteUserId}:${report.id}`;
            const previous = screenShareStatsRef.current.get(sampleKey);
            if (previous) {
              const deltaMs = report.timestamp - previous.timestamp;
              const deltaFrames = framesNowRaw - previous.frames;
              if (deltaMs > 0 && deltaFrames >= 0) {
                const fpsFromDelta = (deltaFrames * 1000) / deltaMs;
                if (Number.isFinite(fpsFromDelta) && fpsFromDelta > 0) {
                  bestSenderFps = Math.max(bestSenderFps, fpsFromDelta);
                }
              }
            }

            screenShareStatsRef.current.set(sampleKey, {
              timestamp: report.timestamp,
              frames: framesNowRaw,
            });
          }

          if (bestSenderFps > 0) {
            fpsValues.push(bestSenderFps);
          }
        } catch {
          // Ignore per-peer stats failure.
        }
      }

      if (disposed) {
        return;
      }

      if (fpsValues.length === 0) {
        setScreenShareFps(null);
        return;
      }

      const average = fpsValues.reduce((sum, fps) => sum + fps, 0) / fpsValues.length;
      const normalized = Math.max(0, Math.min(SCREEN_SHARE_TARGET_FPS, Math.round(average)));
      setScreenShareFps(normalized);
    };

    void collectScreenShareFps();
    screenShareStatsTimerRef.current = window.setInterval(() => {
      void collectScreenShareFps();
    }, 1000) as unknown as number;

    return () => {
      disposed = true;
      if (screenShareStatsTimerRef.current !== null) {
        window.clearInterval(screenShareStatsTimerRef.current);
        screenShareStatsTimerRef.current = null;
      }
      screenShareStatsRef.current.clear();
      setScreenShareFps(null);
    };
  }, [screenSharing]);

  const setVolume = useCallback((value: number) => {
    const next = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
    setVolumeState(next);
  }, []);

  const setInputDevice = useCallback(
    async (deviceId: string): Promise<boolean> => {
      const nextDeviceId = typeof deviceId === "string" && deviceId.trim().length > 0 ? deviceId : DEFAULT_INPUT_DEVICE_ID;
      setSelectedInputDeviceId(nextDeviceId);

      if (!localStreamRef.current) {
        await refreshInputDevices();
        return true;
      }

      let nextStream: MediaStream;
      try {
        nextStream = await requestLocalAudioStream(nextDeviceId);
      } catch {
        return false;
      }

      const nextTrack = nextStream.getAudioTracks()[0];
      if (!nextTrack) {
        nextStream.getTracks().forEach((track) => track.stop());
        return false;
      }

      nextTrack.enabled = !muted;
      for (const [remoteUserId, peer] of peersRef.current.entries()) {
        const screenAudioSender = screenSendersRef.current.get(remoteUserId)?.audio;
        for (const sender of peer.getSenders()) {
          if (sender.track?.kind !== "audio" || sender === screenAudioSender) {
            continue;
          }
          try {
            await sender.replaceTrack(nextTrack);
          } catch {
            // Keep existing sender track if replacement fails for this connection.
          }
        }
      }

      const previousStream = localStreamRef.current;
      localStreamRef.current = nextStream;
      setLocalAudioStream(nextStream);
      previousStream?.getTracks().forEach((track) => track.stop());

      await refreshInputDevices();
      return true;
    },
    [muted, refreshInputDevices, requestLocalAudioStream],
  );

  useEffect(() => {
    if (!connectedChannelId || !currentUserId) {
      return;
    }

    if (pendingInitialOffersChannelRef.current !== connectedChannelId) {
      return;
    }
    if (participants.length === 0) {
      return;
    }

    const run = async () => {
      for (const participant of participants) {
        if (participant.user_id === currentUserId) {
          continue;
        }

        const peer = createPeerConnection(participant.user_id, connectedChannelId, participant.server_id);
        try {
          const offer = await peer.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });
          await peer.setLocalDescription(offer);
          voiceLog("sending offer", {
            channelId: connectedChannelId,
            remoteUserId: participant.user_id,
          });
          sendGatewayEvent("VOICE_SIGNAL", {
            channel_id: connectedChannelId,
            server_id: participant.server_id,
            target_user_id: participant.user_id,
            signal_type: "offer",
            payload: offer,
          });
        } catch {
          closePeer(participant.user_id);
        }
      }
      pendingInitialOffersChannelRef.current = null;
    };

    void run();
  }, [connectedChannelId, createPeerConnection, currentUserId, participants, closePeer, sendGatewayEvent]);

  useEffect(() => {
    if (!connectedChannelId) {
      return;
    }
    const aliveRemoteUsers = new Set(participants.filter((item) => item.user_id !== currentUserId).map((item) => item.user_id));
    for (const peerUserId of Array.from(peersRef.current.keys())) {
      if (!aliveRemoteUsers.has(peerUserId)) {
        closePeer(peerUserId);
      }
    }
  }, [closePeer, connectedChannelId, currentUserId, participants]);

  useEffect(() => {
    if (!connectedChannelId) {
      setRemoteScreenStreams({});
      return;
    }

    const aliveRemoteUsers = new Set(
      participants
        .filter((participant) => participant.user_id !== currentUserId)
        .map((participant) => participant.user_id),
    );

    setRemoteScreenStreams((current) => {
      let changed = false;
      const next: Record<string, MediaStream> = {};

      for (const [userId, stream] of Object.entries(current)) {
        const hasLiveVideoTrack = stream.getVideoTracks().some((track) => track.readyState === "live");
        if (aliveRemoteUsers.has(userId) && hasLiveVideoTrack) {
          next[userId] = stream;
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [connectedChannelId, currentUserId, participants]);

  useEffect(() => {
    if (!connectedChannelId) {
      screenRecoveryAttemptsRef.current.clear();
      return;
    }

    const now = Date.now();
    const retryIntervalMs = 2_500;
    const activeSharers = new Set(
      participants
        .filter((participant) => participant.user_id !== currentUserId && Boolean(participant.screen_sharing))
        .map((participant) => participant.user_id),
    );

    for (const [remoteUserId, lastAttemptAt] of Array.from(screenRecoveryAttemptsRef.current.entries())) {
      if (!activeSharers.has(remoteUserId)) {
        screenRecoveryAttemptsRef.current.delete(remoteUserId);
        continue;
      }
      if (remoteScreenStreams[remoteUserId]?.getVideoTracks().some((track) => track.readyState === "live")) {
        screenRecoveryAttemptsRef.current.delete(remoteUserId);
        continue;
      }
      if (now - lastAttemptAt < retryIntervalMs) {
        continue;
      }

      const peer = peersRef.current.get(remoteUserId);
      if (!peer) {
        continue;
      }
      if (peer.connectionState !== "connected" && peer.connectionState !== "connecting") {
        continue;
      }

      screenRecoveryAttemptsRef.current.set(remoteUserId, now);
      void renegotiatePeer(remoteUserId);
      voiceWarn("screen recovery renegotiation requested", { remoteUserId, state: peer.connectionState });
    }

    for (const remoteUserId of activeSharers) {
      if (remoteScreenStreams[remoteUserId]?.getVideoTracks().some((track) => track.readyState === "live")) {
        screenRecoveryAttemptsRef.current.delete(remoteUserId);
        continue;
      }

      const lastAttemptAt = screenRecoveryAttemptsRef.current.get(remoteUserId) ?? 0;
      if (now - lastAttemptAt < retryIntervalMs) {
        continue;
      }

      const peer = peersRef.current.get(remoteUserId);
      if (!peer) {
        continue;
      }
      if (peer.connectionState !== "connected" && peer.connectionState !== "connecting") {
        continue;
      }

      screenRecoveryAttemptsRef.current.set(remoteUserId, now);
      void renegotiatePeer(remoteUserId);
      voiceWarn("screen recovery renegotiation requested", { remoteUserId, state: peer.connectionState });
    }
  }, [connectedChannelId, currentUserId, participants, remoteScreenStreams, renegotiatePeer]);

  useEffect(() => {
    if (!connectedChannelId) {
      return;
    }

    const queuedCount = signalsByChannel[connectedChannelId]?.length ?? 0;
    if (queuedCount === 0) {
      return;
    }

    const signals = consumeSignals(connectedChannelId);
    if (signals.length === 0) {
      return;
    }

    const run = async () => {
      for (const signal of signals) {
        voiceLog("received signal", {
          channelId: connectedChannelId,
          fromUserId: signal.user_id,
          targetUserId: signal.target_user_id,
          signalType: signal.signal_type,
        });
        if (signal.user_id === currentUserId) {
          continue;
        }
        if (signal.target_user_id && signal.target_user_id !== currentUserId) {
          continue;
        }

        const peer = createPeerConnection(signal.user_id, connectedChannelId, signal.server_id);

        if (signal.signal_type === "offer") {
          try {
            if (peer.signalingState !== "stable") {
              try {
                await peer.setLocalDescription({ type: "rollback" } as RTCSessionDescriptionInit);
              } catch {
                // If rollback is unsupported here, continue with remote offer attempt.
              }
            }
            await peer.setRemoteDescription(new RTCSessionDescription(signal.payload as unknown as RTCSessionDescriptionInit));
            await flushPendingCandidates(signal.user_id, peer);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            sendGatewayEvent("VOICE_SIGNAL", {
              channel_id: connectedChannelId,
              server_id: signal.server_id,
              target_user_id: signal.user_id,
              signal_type: "answer",
              payload: answer,
            });
          } catch {
            closePeer(signal.user_id);
          }
          continue;
        }

        if (signal.signal_type === "answer") {
          try {
            await peer.setRemoteDescription(new RTCSessionDescription(signal.payload as unknown as RTCSessionDescriptionInit));
            await flushPendingCandidates(signal.user_id, peer);
          } catch {
            closePeer(signal.user_id);
          }
          continue;
        }

        if (signal.signal_type === "ice-candidate") {
          const candidate = signal.payload as RTCIceCandidateInit;
          if (!peer.remoteDescription) {
            const queue = pendingCandidatesRef.current.get(signal.user_id) ?? [];
            queue.push(candidate);
            pendingCandidatesRef.current.set(signal.user_id, queue);
            continue;
          }
          try {
            await peer.addIceCandidate(new RTCIceCandidate(candidate));
          } catch {
            // Ignore malformed candidates.
          }
        }
      }
    };

    void run();
  }, [connectedChannelId, consumeSignals, createPeerConnection, currentUserId, flushPendingCandidates, signalsByChannel, sendGatewayEvent, closePeer]);

  useEffect(() => {
    if (!socket || !connectedChannelId) {
      return;
    }

    const rejoin = async () => {
      if (lastRejoinSocketRef.current === socket) {
        return;
      }
      if (!localStreamRef.current) {
        return;
      }

      const channelId = connectedChannelIdRef.current;
      if (!channelId) {
        return;
      }

      const serverId = connectedServerIdRef.current;
      voiceLog("rejoin voice after websocket open", { channelId, serverId });
      lastRejoinSocketRef.current = socket;
      sendGatewayEventRef.current("VOICE_JOIN", {
        channel_id: channelId,
        server_id: serverId,
      });
      sendGatewayEventRef.current("VOICE_STATE_UPDATE", {
        channel_id: channelId,
        server_id: serverId,
        muted,
        deafened,
        screen_sharing: Boolean(localScreenTrackRef.current),
      });
      pendingInitialOffersChannelRef.current = channelId;
    };

    if (socket.readyState === WebSocket.OPEN) {
      void rejoin();
      return;
    }

    socket.addEventListener("open", rejoin);
    return () => socket.removeEventListener("open", rejoin);
  }, [connectedChannelId, deafened, muted, socket]);

  useEffect(() => {
    if (!connectedChannelId) {
      closeAllPeers();
      setRemoteStreams({});
      setRemoteScreenStreams({});
      pendingInitialOffersChannelRef.current = null;
      connectedServerIdRef.current = null;
      lastRejoinSocketRef.current = null;
      screenSendersRef.current.clear();
      clearLocalScreenState(true);
    }
  }, [clearLocalScreenState, closeAllPeers, connectedChannelId]);

  useEffect(() => {
    return () => {
      const activeChannelId = connectedChannelIdRef.current;
      if (activeChannelId) {
        sendGatewayEventRef.current("VOICE_LEAVE", { channel_id: activeChannelId });
      }
      stopLocalStream();
      clearLocalScreenState(true);
      screenSendersRef.current.clear();
      if (screenShareStatsTimerRef.current !== null) {
        window.clearInterval(screenShareStatsTimerRef.current);
        screenShareStatsTimerRef.current = null;
      }
      screenShareStatsRef.current.clear();
      setScreenShareFps(null);
      closeAllPeers();
      setRemoteStreams({});
      setRemoteScreenStreams({});
      const presenceAudioElements = presenceAudioElementsRef.current;
      for (const key of ["join", "leave"] as const) {
        const audio = presenceAudioElements[key];
        if (!audio) {
          continue;
        }
        audio.pause();
        audio.src = "";
        presenceAudioElements[key] = null;
      }
      failedPresenceWavRef.current = { join: false, leave: false };
      if (presenceAudioContextRef.current) {
        void presenceAudioContextRef.current.close().catch(() => undefined);
        presenceAudioContextRef.current = null;
      }
      if (activeChannelId) {
        clearChannel(activeChannelId);
      }
      setConnectedChannel(null);
    };
  }, [clearChannel, clearLocalScreenState, closeAllPeers, setConnectedChannel, stopLocalStream]);

  return {
    connectedChannelId,
    participants,
    localAudioStream,
    remoteStreams,
    remoteScreenStreams,
    localScreenStream,
    screenShareFps,
    muted,
    deafened,
    screenSharing,
    volume,
    inputDevices,
    selectedInputDeviceId,
    screenSources,
    selectedScreenSourceId,
    join,
    leave,
    toggleMuted,
    toggleDeafened,
    toggleScreenShare,
    setVolume,
    setInputDevice,
    refreshScreenSources,
    setScreenSource,
  };
};
