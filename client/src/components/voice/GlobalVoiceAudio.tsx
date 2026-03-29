import { useEffect, useMemo, useRef } from "react";

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

  const remoteParticipants = useMemo(
    () => participants.filter((participant) => participant.user_id !== currentUserId),
    [currentUserId, participants],
  );

  useEffect(() => {
    const aliveUserIds = new Set(remoteParticipants.map((participant) => participant.user_id));
    for (const participant of remoteParticipants) {
      const audio = audioRefs.current[participant.user_id];
      if (!audio) {
        continue;
      }

      const nextStream = remoteStreams[participant.user_id] ?? null;
      const media = audio as HTMLAudioElement & { srcObject: MediaStream | null };
      if (media.srcObject !== nextStream) {
        media.srcObject = nextStream;
      }
      audio.muted = deafened;
      audio.volume = volume;
      void audio.play().catch(() => undefined);
    }

    for (const [userId, element] of Object.entries(audioRefs.current)) {
      if (aliveUserIds.has(userId)) {
        continue;
      }
      if (element) {
        const media = element as HTMLAudioElement & { srcObject: MediaStream | null };
        media.srcObject = null;
      }
      delete audioRefs.current[userId];
    }
  }, [deafened, remoteParticipants, remoteStreams, volume]);

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
    };
  }, []);

  if (!connectedChannelId || remoteParticipants.length === 0) {
    return null;
  }

  return (
    <>
      {remoteParticipants.map((participant) => (
        <audio
          key={`global-voice-audio-${participant.user_id}`}
          ref={(element) => {
            audioRefs.current[participant.user_id] = element;
          }}
          autoPlay
          playsInline
          className="hidden"
        />
      ))}
    </>
  );
};
