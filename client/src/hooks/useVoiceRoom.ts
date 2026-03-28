import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuthStore } from "@/store/authStore";
import { type VoiceParticipant, useVoiceStore } from "@/store/voiceStore";

export interface VoiceInputDevice {
  deviceId: string;
  label: string;
}

interface UseVoiceRoomResult {
  connectedChannelId: string | null;
  participants: VoiceParticipant[];
  remoteStreams: Record<string, MediaStream>;
  muted: boolean;
  deafened: boolean;
  volume: number;
  inputDevices: VoiceInputDevice[];
  selectedInputDeviceId: string;
  join: (channelId: string, serverId: string | null) => Promise<boolean>;
  leave: () => Promise<void>;
  toggleMuted: () => void;
  toggleDeafened: () => void;
  setVolume: (value: number) => void;
  setInputDevice: (deviceId: string) => Promise<boolean>;
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
const DISCONNECTED_CLOSE_DELAY_MS = 12_000;

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

export const useVoiceRoom = (socket: WebSocket | null): UseVoiceRoomResult => {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const connectedChannelId = useVoiceStore((state) => state.connectedChannelId);
  const participantsByChannel = useVoiceStore((state) => state.participantsByChannel);
  const signalsByChannel = useVoiceStore((state) => state.signalsByChannel);
  const setConnectedChannel = useVoiceStore((state) => state.setConnectedChannel);
  const consumeSignals = useVoiceStore((state) => state.consumeSignals);
  const clearChannel = useVoiceStore((state) => state.clearChannel);

  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [inputDevices, setInputDevices] = useState<VoiceInputDevice[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState(DEFAULT_INPUT_DEVICE_ID);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const disconnectTimersRef = useRef<Map<string, number>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const pendingInitialOffersChannelRef = useRef<string | null>(null);
  const connectedServerIdRef = useRef<string | null>(null);
  const connectedChannelIdRef = useRef<string | null>(null);
  const sendGatewayEventRef = useRef<(type: string, data: Record<string, unknown>) => boolean>(() => false);

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

  useEffect(() => {
    connectedChannelIdRef.current = connectedChannelId;
  }, [connectedChannelId]);

  useEffect(() => {
    sendGatewayEventRef.current = sendGatewayEvent;
  }, [sendGatewayEvent]);

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
  }, []);

  const closePeer = useCallback((remoteUserId: string) => {
    const disconnectTimer = disconnectTimersRef.current.get(remoteUserId);
    if (disconnectTimer) {
      window.clearTimeout(disconnectTimer);
      disconnectTimersRef.current.delete(remoteUserId);
    }

    const peer = peersRef.current.get(remoteUserId);
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
      peersRef.current.delete(remoteUserId);
    }
    pendingCandidatesRef.current.delete(remoteUserId);
    setRemoteStreams((current) => {
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

  useEffect(() => {
    void refreshInputDevices();

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
  }, [refreshInputDevices]);

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
        return existing;
      }

      voiceLog("creating peer", {
        remoteUserId,
        channelId,
        serverId,
        iceServers: ICE_SERVERS,
      });
      const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const localStream = localStreamRef.current;
      if (localStream) {
        for (const track of localStream.getTracks()) {
          peer.addTrack(track, localStream);
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
        const [stream] = event.streams;
        if (!stream) {
          return;
        }
        voiceLog("remote track received", {
          remoteUserId,
          trackId: event.track.id,
          streamId: stream.id,
        });
        setRemoteStreams((current) => ({ ...current, [remoteUserId]: stream }));
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
          return;
        }

        if (state === "disconnected") {
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

        if (state === "failed" || state === "closed") {
          closePeer(remoteUserId);
        }
      };

      peersRef.current.set(remoteUserId, peer);
      return peer;
    },
    [closePeer, sendGatewayEvent],
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
        clearChannel(connectedChannelId);
      }

      try {
        if (!localStreamRef.current) {
          const stream = await requestLocalAudioStream(selectedInputDeviceId);
          stream.getAudioTracks().forEach((track) => {
            track.enabled = !muted;
          });
          localStreamRef.current = stream;
          await refreshInputDevices();
        }
      } catch {
        return false;
      }

      closeAllPeers();
      setRemoteStreams({});
      pendingInitialOffersChannelRef.current = channelId;
      connectedServerIdRef.current = serverId;
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
      });

      const hasSnapshot = await waitForParticipantsSnapshot(channelId);
      if (!hasSnapshot) {
        voiceWarn("participants snapshot timeout", { channelId });
        pendingInitialOffersChannelRef.current = null;
        connectedServerIdRef.current = null;
        stopLocalStream();
        closeAllPeers();
        setRemoteStreams({});
        clearChannel(channelId);
        setConnectedChannel(null);
        return false;
      }

      voiceLog("join completed", { channelId, serverId, participantsCount: useVoiceStore.getState().participantsByChannel[channelId]?.length ?? 0 });
      return true;
    },
    [
      clearChannel,
      closeAllPeers,
      connectedChannelId,
      deafened,
      muted,
      refreshInputDevices,
      requestLocalAudioStream,
      selectedInputDeviceId,
      sendGatewayEvent,
      setConnectedChannel,
      socket,
      stopLocalStream,
      waitForParticipantsSnapshot,
      waitForSocketOpen,
    ],
  );

  const leave = useCallback(async () => {
    const channelId = connectedChannelId;
    if (channelId) {
      sendGatewayEvent("VOICE_LEAVE", { channel_id: channelId });
      clearChannel(channelId);
    }

    pendingInitialOffersChannelRef.current = null;
    connectedServerIdRef.current = null;
    stopLocalStream();
    closeAllPeers();
    setRemoteStreams({});
    setConnectedChannel(null);
  }, [clearChannel, closeAllPeers, connectedChannelId, sendGatewayEvent, setConnectedChannel, stopLocalStream]);

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
      });
    }
  }, [connectedChannelId, deafened, muted, sendGatewayEvent]);

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
      for (const peer of peersRef.current.values()) {
        for (const sender of peer.getSenders()) {
          if (sender.track?.kind !== "audio") {
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
          const offer = await peer.createOffer();
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
      if (!localStreamRef.current) {
        return;
      }

      const channelId = connectedChannelIdRef.current;
      if (!channelId) {
        return;
      }

      const serverId = connectedServerIdRef.current;
      voiceLog("rejoin voice after websocket open", { channelId, serverId });
      sendGatewayEventRef.current("VOICE_JOIN", {
        channel_id: channelId,
        server_id: serverId,
      });
      sendGatewayEventRef.current("VOICE_STATE_UPDATE", {
        channel_id: channelId,
        server_id: serverId,
        muted,
        deafened,
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
      pendingInitialOffersChannelRef.current = null;
      connectedServerIdRef.current = null;
    }
  }, [closeAllPeers, connectedChannelId]);

  useEffect(() => {
    return () => {
      const activeChannelId = connectedChannelIdRef.current;
      if (activeChannelId) {
        sendGatewayEventRef.current("VOICE_LEAVE", { channel_id: activeChannelId });
      }
      stopLocalStream();
      closeAllPeers();
      setRemoteStreams({});
      if (activeChannelId) {
        clearChannel(activeChannelId);
      }
      setConnectedChannel(null);
    };
  }, [clearChannel, closeAllPeers, setConnectedChannel, stopLocalStream]);

  return {
    connectedChannelId,
    participants,
    remoteStreams,
    muted,
    deafened,
    volume,
    inputDevices,
    selectedInputDeviceId,
    join,
    leave,
    toggleMuted,
    toggleDeafened,
    setVolume,
    setInputDevice,
  };
};
