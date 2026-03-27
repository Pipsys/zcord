import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuthStore } from "@/store/authStore";
import { type VoiceParticipant, useVoiceStore } from "@/store/voiceStore";

interface UseVoiceRoomResult {
  connectedChannelId: string | null;
  participants: VoiceParticipant[];
  remoteStreams: Record<string, MediaStream>;
  muted: boolean;
  deafened: boolean;
  volume: number;
  join: (channelId: string, serverId: string | null) => Promise<boolean>;
  leave: () => Promise<void>;
  toggleMuted: () => void;
  toggleDeafened: () => void;
  setVolume: (value: number) => void;
}

const buildIceServers = (): RTCIceServer[] => {
  const stunConfigured = import.meta.env.VITE_WEBRTC_STUN_URLS as string | undefined;
  const stunUrls =
    typeof stunConfigured === "string" && stunConfigured.trim().length > 0
      ? stunConfigured
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : ["stun:stun.l.google.com:19302"];

  const servers: RTCIceServer[] = [{ urls: stunUrls }];

  const turnUrl = import.meta.env.VITE_WEBRTC_TURN_URL as string | undefined;
  const turnUsername = import.meta.env.VITE_WEBRTC_TURN_USERNAME as string | undefined;
  const turnCredential = import.meta.env.VITE_WEBRTC_TURN_CREDENTIAL as string | undefined;
  if (typeof turnUrl === "string" && turnUrl.trim().length > 0 && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
};

const ICE_SERVERS = buildIceServers();

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

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const pendingInitialOffersChannelRef = useRef<string | null>(null);

  const participants = useMemo(() => {
    if (!connectedChannelId) {
      return [];
    }
    return participantsByChannel[connectedChannelId] ?? [];
  }, [connectedChannelId, participantsByChannel]);

  const sendGatewayEvent = useCallback(
    (type: string, data: Record<string, unknown>): boolean => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify({ t: type, d: data }));
      return true;
    },
    [socket],
  );

  const stopLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }, []);

  const closePeer = useCallback((remoteUserId: string) => {
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
    const userIds = Array.from(peersRef.current.keys());
    for (const remoteUserId of userIds) {
      closePeer(remoteUserId);
    }
  }, [closePeer]);

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
        setRemoteStreams((current) => ({ ...current, [remoteUserId]: stream }));
      };

      peer.onconnectionstatechange = () => {
        if (["failed", "closed", "disconnected"].includes(peer.connectionState)) {
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
      if (!socket || socket.readyState !== WebSocket.OPEN) {
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
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          stream.getAudioTracks().forEach((track) => {
            track.enabled = !muted;
          });
          localStreamRef.current = stream;
        }
      } catch {
        return false;
      }

      closeAllPeers();
      setRemoteStreams({});
      pendingInitialOffersChannelRef.current = channelId;
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

      return true;
    },
    [clearChannel, closeAllPeers, connectedChannelId, deafened, muted, sendGatewayEvent, setConnectedChannel, socket],
  );

  const leave = useCallback(async () => {
    const channelId = connectedChannelId;
    if (channelId) {
      sendGatewayEvent("VOICE_LEAVE", { channel_id: channelId });
      clearChannel(channelId);
    }

    pendingInitialOffersChannelRef.current = null;
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

  useEffect(() => {
    if (!connectedChannelId || !currentUserId) {
      return;
    }

    if (pendingInitialOffersChannelRef.current !== connectedChannelId) {
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
        if (signal.user_id === currentUserId) {
          continue;
        }
        if (signal.target_user_id && signal.target_user_id !== currentUserId) {
          continue;
        }

        const peer = createPeerConnection(signal.user_id, connectedChannelId, signal.server_id);

        if (signal.signal_type === "offer") {
          try {
            await peer.setRemoteDescription(new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit));
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
            await peer.setRemoteDescription(new RTCSessionDescription(signal.payload as RTCSessionDescriptionInit));
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
    if (!connectedChannelId) {
      closeAllPeers();
      setRemoteStreams({});
      pendingInitialOffersChannelRef.current = null;
    }
  }, [closeAllPeers, connectedChannelId]);

  useEffect(() => {
    return () => {
      if (connectedChannelId) {
        sendGatewayEvent("VOICE_LEAVE", { channel_id: connectedChannelId });
      }
      stopLocalStream();
      closeAllPeers();
      setRemoteStreams({});
      if (connectedChannelId) {
        clearChannel(connectedChannelId);
      }
      setConnectedChannel(null);
    };
  }, [clearChannel, closeAllPeers, connectedChannelId, sendGatewayEvent, setConnectedChannel, stopLocalStream]);

  return {
    connectedChannelId,
    participants,
    remoteStreams,
    muted,
    deafened,
    volume,
    join,
    leave,
    toggleMuted,
    toggleDeafened,
    setVolume,
  };
};
