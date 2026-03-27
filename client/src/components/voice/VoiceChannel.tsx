import { useEffect, useMemo, useRef } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { VoiceControls } from "@/components/voice/VoiceControls";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import type { VoiceParticipant } from "@/store/voiceStore";

interface VoiceChannelProps {
  channelId: string | null;
  channelName: string | null;
  connected: boolean;
  participants: VoiceParticipant[];
  remoteStreams: Record<string, MediaStream>;
  muted: boolean;
  deafened: boolean;
  volume: number;
  onConnect: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onVolumeChange: (value: number) => void;
}

const toParticipantName = (participant: VoiceParticipant, currentUserId: string | null, currentUsername: string | null): string => {
  if (typeof participant.username === "string" && participant.username.trim().length > 0) {
    return participant.username;
  }
  if (participant.user_id === currentUserId && currentUsername) {
    return currentUsername;
  }
  return `user-${participant.user_id.slice(0, 6)}`;
};

export const VoiceChannel = ({
  channelId,
  channelName,
  connected,
  participants,
  remoteStreams,
  muted,
  deafened,
  volume,
  onConnect,
  onLeave,
  onToggleMute,
  onToggleDeafen,
  onVolumeChange,
}: VoiceChannelProps) => {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  const visibleParticipants = useMemo(() => {
    if (!connected) {
      return [];
    }
    const dedup = new Map<string, VoiceParticipant>();
    for (const participant of participants) {
      dedup.set(participant.user_id, participant);
    }

    const currentUserId = user?.id ?? null;
    const list = Array.from(dedup.values());
    list.sort((left, right) => {
      if (left.user_id === currentUserId) {
        return -1;
      }
      if (right.user_id === currentUserId) {
        return 1;
      }
      return left.user_id.localeCompare(right.user_id);
    });
    return list;
  }, [connected, participants, user?.id]);

  useEffect(() => {
    for (const participant of visibleParticipants) {
      if (participant.user_id === user?.id) {
        continue;
      }
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
    }
  }, [deafened, remoteStreams, user?.id, visibleParticipants, volume]);

  useEffect(() => {
    return () => {
      for (const audio of Object.values(audioRefs.current)) {
        if (!audio) {
          continue;
        }
        const media = audio as HTMLAudioElement & { srcObject: MediaStream | null };
        media.srcObject = null;
      }
    };
  }, []);

  return (
    <section className="m-4 rounded-xl border border-white/10 bg-black/20 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.35)]">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-paw-text-muted">{t("voice.title")}</h3>
        <span className={`rounded-md border border-white/10 px-2 py-1 text-xs font-semibold ${connected ? "bg-[#3ba55d] text-white" : "bg-black/25 text-paw-text-muted"}`}>
          {connected ? t("voice.connected") : t("voice.not_connected")}
        </span>
      </div>

      <p className="mb-3 text-sm text-paw-text-secondary">{channelName ? `#${channelName}` : t("server.voice_panel_hint")}</p>

      {connected ? (
        <div className="mb-4 space-y-2">
          {visibleParticipants.map((participant) => {
            const name = toParticipantName(participant, user?.id ?? null, user?.username ?? null);
            const isCurrentUser = participant.user_id === user?.id;
            const avatarSource = isCurrentUser
              ? participant.avatar_url ?? user?.avatar_url ?? null
              : participant.avatar_url ?? null;
            return (
              <div key={participant.user_id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <Avatar src={avatarSource} label={name} online={!participant.deafened} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-paw-text-secondary">{name}</p>
                  <p className="text-xs text-paw-text-muted">
                    {participant.muted ? t("voice.mute") : t("voice.connected")}
                    {participant.deafened ? ` · ${t("voice.deafen")}` : ""}
                  </p>
                </div>
                {!isCurrentUser ? (
                  <audio
                    ref={(element) => {
                      audioRefs.current[participant.user_id] = element;
                    }}
                    autoPlay
                    playsInline
                    className="hidden"
                  />
                ) : null}
              </div>
            );
          })}

          {visibleParticipants.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm text-paw-text-muted">{t("voice.no_participants")}</div>
          ) : null}
        </div>
      ) : (
        <div className="mb-4 rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm text-paw-text-muted">{t("voice.no_participants")}</div>
      )}

      <div className="mb-3">
        {!connected ? (
          <button
            disabled={!channelId}
            className="rounded-md border border-white/10 bg-paw-accent px-3 py-2 text-sm font-semibold text-white shadow-[0_6px_18px_var(--color-accent-glow)] transition-colors hover:bg-paw-accentSecondary disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onConnect}
          >
            {t("voice.connect")}
          </button>
        ) : null}
      </div>

      <VoiceControls
        muted={muted}
        deafened={deafened}
        connected={connected}
        onToggleMute={onToggleMute}
        onToggleDeafen={onToggleDeafen}
        onLeave={onLeave}
        onVolumeChange={onVolumeChange}
      />
    </section>
  );
};
