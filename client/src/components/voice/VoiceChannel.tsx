import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { VoiceControls } from "@/components/voice/VoiceControls";
import type { ScreenShareSource, VoiceInputDevice } from "@/hooks/useVoiceRoom";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import type { VoiceParticipant } from "@/store/voiceStore";

interface VoiceChannelProps {
  channelId: string | null;
  channelName: string | null;
  connected: boolean;
  participants: VoiceParticipant[];
  remoteStreams: Record<string, MediaStream>;
  remoteScreenStreams: Record<string, MediaStream>;
  localAudioStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  muted: boolean;
  deafened: boolean;
  screenSharing: boolean;
  volume: number;
  inputDevices: VoiceInputDevice[];
  selectedInputDeviceId: string;
  screenSources: ScreenShareSource[];
  selectedScreenSourceId: string;
  onConnect: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onVolumeChange: (value: number) => void;
  onInputDeviceChange: (deviceId: string) => void;
  onRefreshScreenSources: () => void;
  onScreenSourceChange: (sourceId: string) => void;
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
  remoteScreenStreams,
  localAudioStream,
  localScreenStream,
  muted,
  deafened,
  screenSharing,
  volume,
  inputDevices,
  selectedInputDeviceId,
  screenSources,
  selectedScreenSourceId,
  onConnect,
  onLeave,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onVolumeChange,
  onInputDeviceChange,
  onRefreshScreenSources,
  onScreenSourceChange,
}: VoiceChannelProps) => {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const fullscreenVideoRef = useRef<HTMLVideoElement | null>(null);

  const [speakingUserIds, setSpeakingUserIds] = useState<string[]>([]);
  const [fullscreenUserId, setFullscreenUserId] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const speakingTimerRef = useRef<number | null>(null);
  const analyserEntriesRef = useRef<
    Map<
      string,
      {
        source: MediaStreamAudioSourceNode;
        analyser: AnalyserNode;
        samples: Uint8Array;
        streamId: string;
      }
    >
  >(new Map());

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

  const speakingSet = useMemo(() => new Set(speakingUserIds), [speakingUserIds]);

  const resolveScreenStream = (participantUserId: string): MediaStream | null => {
    if (participantUserId === user?.id) {
      return localScreenStream;
    }
    return remoteScreenStreams[participantUserId] ?? null;
  };

  const screenParticipants = useMemo(
    () =>
      visibleParticipants.filter((participant) => {
        return Boolean(resolveScreenStream(participant.user_id));
      }),
    [remoteScreenStreams, user?.id, visibleParticipants, localScreenStream],
  );

  const fullscreenStream = useMemo(() => {
    if (!fullscreenUserId) {
      return null;
    }
    return resolveScreenStream(fullscreenUserId);
  }, [fullscreenUserId, remoteScreenStreams, user?.id, localScreenStream]);

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
      void audio.play().catch(() => undefined);
    }
  }, [deafened, remoteStreams, user?.id, visibleParticipants, volume]);

  useEffect(() => {
    for (const participant of screenParticipants) {
      const video = videoRefs.current[participant.user_id];
      if (!video) {
        continue;
      }

      const nextStream = resolveScreenStream(participant.user_id);
      const media = video as HTMLVideoElement & { srcObject: MediaStream | null };
      if (media.srcObject !== nextStream) {
        media.srcObject = nextStream;
      }

      if (nextStream) {
        video.muted = participant.user_id === user?.id;
        void video.play().catch(() => undefined);
      }
    }
  }, [screenParticipants, user?.id, remoteScreenStreams, localScreenStream]);

  useEffect(() => {
    const video = fullscreenVideoRef.current;
    if (!video) {
      return;
    }

    const media = video as HTMLVideoElement & { srcObject: MediaStream | null };
    if (media.srcObject !== fullscreenStream) {
      media.srcObject = fullscreenStream;
    }

    if (fullscreenStream) {
      video.muted = fullscreenUserId === user?.id;
      void video.play().catch(() => undefined);
    }
  }, [fullscreenStream, fullscreenUserId, user?.id]);

  useEffect(() => {
    if (!fullscreenUserId) {
      return;
    }

    const hasStream = visibleParticipants.some((participant) => participant.user_id === fullscreenUserId && resolveScreenStream(participant.user_id));
    if (!hasStream) {
      setFullscreenUserId(null);
    }
  }, [fullscreenUserId, visibleParticipants, remoteScreenStreams, localScreenStream, user?.id]);

  useEffect(() => {
    if (!fullscreenUserId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullscreenUserId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreenUserId]);

  useEffect(() => {
    if (!connected) {
      setSpeakingUserIds([]);
      return;
    }

    const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor();
    }

    const context = audioContextRef.current;
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined);
    }

    const participantMap = new Map<string, VoiceParticipant>();
    for (const participant of visibleParticipants) {
      participantMap.set(participant.user_id, participant);
    }

    const targetStreams = new Map<string, MediaStream>();
    for (const participant of visibleParticipants) {
      const stream = participant.user_id === user?.id ? localAudioStream : remoteStreams[participant.user_id];
      if (stream && stream.getAudioTracks().length > 0) {
        targetStreams.set(participant.user_id, stream);
      }
    }

    for (const [userId, entry] of Array.from(analyserEntriesRef.current.entries())) {
      const target = targetStreams.get(userId);
      if (!target || target.id !== entry.streamId) {
        entry.source.disconnect();
        entry.analyser.disconnect();
        analyserEntriesRef.current.delete(userId);
      }
    }

    for (const [userId, stream] of Array.from(targetStreams.entries())) {
      if (analyserEntriesRef.current.has(userId)) {
        continue;
      }

      try {
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.85;
        source.connect(analyser);
        analyserEntriesRef.current.set(userId, {
          source,
          analyser,
          samples: new Uint8Array(analyser.fftSize),
          streamId: stream.id,
        });
      } catch {
        // ignore analyzer setup failures
      }
    }

    const evaluateSpeaking = () => {
      const threshold = 0.035;
      const speaking: string[] = [];

      for (const [userId, entry] of Array.from(analyserEntriesRef.current.entries())) {
        const participant = participantMap.get(userId);
        if (!participant) {
          continue;
        }
        if (participant.muted || (userId === user?.id && muted)) {
          continue;
        }

        entry.analyser.getByteTimeDomainData(entry.samples);
        let sumSquares = 0;
        for (const sample of entry.samples) {
          const normalized = (sample - 128) / 128;
          sumSquares += normalized * normalized;
        }
        const rms = Math.sqrt(sumSquares / entry.samples.length);
        if (rms > threshold) {
          speaking.push(userId);
        }
      }

      setSpeakingUserIds((current) => {
        if (current.length === speaking.length && current.every((id, index) => id === speaking[index])) {
          return current;
        }
        return speaking;
      });
    };

    evaluateSpeaking();
    speakingTimerRef.current = window.setInterval(evaluateSpeaking, 140) as unknown as number;

    return () => {
      if (speakingTimerRef.current !== null) {
        window.clearInterval(speakingTimerRef.current);
        speakingTimerRef.current = null;
      }
    };
  }, [connected, localAudioStream, muted, remoteStreams, user?.id, visibleParticipants]);

  useEffect(() => {
    return () => {
      if (speakingTimerRef.current !== null) {
        window.clearInterval(speakingTimerRef.current);
        speakingTimerRef.current = null;
      }

      for (const entry of Array.from(analyserEntriesRef.current.values())) {
        entry.source.disconnect();
        entry.analyser.disconnect();
      }
      analyserEntriesRef.current.clear();

      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }

      for (const audio of Object.values(audioRefs.current)) {
        if (!audio) {
          continue;
        }
        const media = audio as HTMLAudioElement & { srcObject: MediaStream | null };
        media.srcObject = null;
      }

      for (const video of Object.values(videoRefs.current)) {
        if (!video) {
          continue;
        }
        const media = video as HTMLVideoElement & { srcObject: MediaStream | null };
        media.srcObject = null;
      }

      if (fullscreenVideoRef.current) {
        const media = fullscreenVideoRef.current as HTMLVideoElement & { srcObject: MediaStream | null };
        media.srcObject = null;
      }
    };
  }, []);

  return (
    <section className="m-4 rounded-xl border border-white/10 bg-black/20 p-4 shadow-[0_10px_22px_rgba(0,0,0,0.32)]">
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
            const isSpeaking = speakingSet.has(participant.user_id);
            const isSharingScreen = Boolean(participant.screen_sharing || (isCurrentUser && screenSharing));
            const avatarSource = isCurrentUser ? participant.avatar_url ?? user?.avatar_url ?? null : participant.avatar_url ?? null;

            return (
              <div
                key={participant.user_id}
                className={`flex items-center gap-2 rounded-lg border bg-black/20 px-3 py-2 ${
                  isSpeaking ? "border-[#43b581]/80 shadow-[0_0_0_1px_rgba(67,181,129,0.28)]" : "border-white/10"
                }`}
              >
                <Avatar src={avatarSource} label={name} online={!participant.deafened} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-paw-text-secondary">{name}</p>
                  <p className="text-xs text-paw-text-muted">
                    {participant.muted ? t("voice.mute") : t("voice.connected")}
                    {participant.deafened ? ` | ${t("voice.deafen")}` : ""}
                    {isSpeaking ? ` | ${t("voice.speaking")}` : ""}
                    {isSharingScreen ? ` | ${t("voice.live_badge")}` : ""}
                  </p>
                </div>
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

      {connected && screenParticipants.length > 0 ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {screenParticipants.map((participant) => {
            const name = toParticipantName(participant, user?.id ?? null, user?.username ?? null);
            const isCurrentUser = participant.user_id === user?.id;
            return (
              <div key={`screen-${participant.user_id}`} className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
                <div className="flex items-center justify-between border-b border-white/10 px-2.5 py-2">
                  <span className="truncate text-xs font-semibold text-paw-text-secondary">{name}</span>
                  <button
                    onClick={() => setFullscreenUserId(participant.user_id)}
                    className="rounded border border-white/12 bg-black/25 px-2 py-1 text-[11px] font-semibold text-paw-text-secondary hover:text-paw-text-primary"
                  >
                    {t("voice.expand_stream")}
                  </button>
                </div>
                <video
                  ref={(element) => {
                    videoRefs.current[participant.user_id] = element;
                  }}
                  autoPlay
                  playsInline
                  muted={isCurrentUser}
                  className="block h-[220px] w-full bg-black object-contain"
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {connected
        ? visibleParticipants
            .filter((participant) => participant.user_id !== user?.id)
            .map((participant) => (
              <audio
                key={`audio-${participant.user_id}`}
                ref={(element) => {
                  audioRefs.current[participant.user_id] = element;
                }}
                autoPlay
                playsInline
                className="hidden"
              />
            ))
        : null}

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
        screenSharing={screenSharing}
        inputDevices={inputDevices}
        selectedInputDeviceId={selectedInputDeviceId}
        screenSources={screenSources}
        selectedScreenSourceId={selectedScreenSourceId}
        onToggleMute={onToggleMute}
        onToggleDeafen={onToggleDeafen}
        onToggleScreenShare={onToggleScreenShare}
        onLeave={onLeave}
        onVolumeChange={onVolumeChange}
        onInputDeviceChange={onInputDeviceChange}
        onRefreshScreenSources={onRefreshScreenSources}
        onScreenSourceChange={onScreenSourceChange}
      />

      {fullscreenUserId && fullscreenStream ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/95 p-4" onClick={() => setFullscreenUserId(null)}>
          <div className="relative h-full w-full max-w-[1600px]" onClick={(event) => event.stopPropagation()}>
            <button
              className="absolute right-3 top-3 z-10 rounded-md border border-white/15 bg-black/50 px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => setFullscreenUserId(null)}
            >
              {t("voice.fullscreen_close")}
            </button>
            <video ref={fullscreenVideoRef} autoPlay playsInline className="h-full w-full bg-black object-contain" />
          </div>
        </div>
      ) : null}
    </section>
  );
};
