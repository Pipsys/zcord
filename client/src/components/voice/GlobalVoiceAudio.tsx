import { useCallback, useEffect, useMemo, useRef } from "react";

import { useAuthStore } from "@/store/authStore";
import type { VoiceParticipant } from "@/store/voiceStore";

interface GlobalVoiceAudioProps {
  connectedChannelId: string | null;
  participants: VoiceParticipant[];
  remoteStreams: Record<string, MediaStream>;
  deafened: boolean;
  volume: number;
}

export const GlobalVoiceAudio = ({ connectedChannelId, participants, remoteStreams, deafened, volume }: GlobalVoiceAudioProps) => {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const trackStreamsRef = useRef<Record<string, MediaStream>>({});

  const safePlayAudio = useCallback(async (audio: HTMLAudioElement, desiredMuted: boolean): Promise<void> => {
    audio.muted = desiredMuted;
    try {
      await audio.play();
      return;
    } catch {
      // Fallback for autoplay policies: start muted first, then unmute.
    }

    if (desiredMuted) {
      return;
    }

    try {
      audio.muted = true;
      await audio.play();
      audio.muted = false;
      void audio.play().catch(() => undefined);
    } catch {
      // Keep track attached; next user gesture can start playback.
    }
  }, []);

  const remoteParticipants = useMemo(
    () => participants.filter((participant) => participant.user_id !== currentUserId),
    [currentUserId, participants],
  );

  const remoteTrackEntries = useMemo(
    () =>
      remoteParticipants.flatMap((participant) => {
        const stream = remoteStreams[participant.user_id];
        if (!stream) {
          return [];
        }
        return stream.getAudioTracks().map((track) => ({
          key: `${participant.user_id}:${track.id}`,
          userId: participant.user_id,
          track,
        }));
      }),
    [remoteParticipants, remoteStreams],
  );

  useEffect(() => {
    const aliveTrackKeys = new Set(remoteTrackEntries.map((entry) => entry.key));
    for (const entry of remoteTrackEntries) {
      const audio = audioRefs.current[entry.key];
      if (!audio) {
        continue;
      }

      const cachedStream = trackStreamsRef.current[entry.key];
      const hasSameTrack = cachedStream?.getAudioTracks().some((track) => track.id === entry.track.id) ?? false;
      const nextStream = hasSameTrack ? cachedStream : new MediaStream([entry.track]);
      if (!hasSameTrack) {
        trackStreamsRef.current[entry.key] = nextStream;
      }

      const media = audio as HTMLAudioElement & { srcObject: MediaStream | null };
      if (media.srcObject !== nextStream) {
        media.srcObject = nextStream;
      }
      audio.muted = deafened;
      audio.volume = volume;
      void safePlayAudio(audio, deafened);
    }

    for (const [userId, element] of Object.entries(audioRefs.current)) {
      if (aliveTrackKeys.has(userId)) {
        continue;
      }
      if (element) {
        const media = element as HTMLAudioElement & { srcObject: MediaStream | null };
        media.srcObject = null;
      }
      delete audioRefs.current[userId];
      delete trackStreamsRef.current[userId];
    }
  }, [deafened, remoteTrackEntries, safePlayAudio, volume]);

  useEffect(() => {
    return () => {
      for (const element of Object.values(audioRefs.current)) {
        if (!element) {
          continue;
        }
        const media = element as HTMLAudioElement & { srcObject: MediaStream | null };
        media.srcObject = null;
      }
      audioRefs.current = {};
      trackStreamsRef.current = {};
    };
  }, []);

  if (!connectedChannelId || remoteTrackEntries.length === 0) {
    return null;
  }

  return (
    <>
      {remoteTrackEntries.map((entry) => (
        <audio
          key={`global-voice-audio-${entry.key}`}
          ref={(element) => {
            audioRefs.current[entry.key] = element;
          }}
          autoPlay
          playsInline
          className="hidden"
        />
      ))}
    </>
  );
};
