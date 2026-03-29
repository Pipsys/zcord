import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";

import { Avatar } from "@/components/ui/Avatar";
import { VoiceControls } from "@/components/voice/VoiceControls";
import type { ScreenShareSource, VoiceInputDevice } from "@/hooks/useVoiceRoom";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import type { VoiceParticipant } from "@/store/voiceStore";

interface VoiceChannelProps {
  serverName: string | null;
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
  serverName,
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

  const participantTiles = useMemo(() => {
    return visibleParticipants.map((participant) => {
      const name = toParticipantName(participant, user?.id ?? null, user?.username ?? null);
      const isCurrentUser = participant.user_id === user?.id;
      const isSpeaking = speakingSet.has(participant.user_id);
      const screenStream = resolveScreenStream(participant.user_id);
      const isSharingScreen = Boolean(participant.screen_sharing || (isCurrentUser && screenSharing) || screenStream);
      const avatarSource = isCurrentUser ? participant.avatar_url ?? user?.avatar_url ?? null : participant.avatar_url ?? null;

      return {
        participant,
        name,
        isCurrentUser,
        isSpeaking,
        screenStream,
        isSharingScreen,
        avatarSource,
      };
    });
  }, [resolveScreenStream, screenSharing, speakingSet, user?.avatar_url, user?.id, user?.username, visibleParticipants]);

  const resolveGridClass = (count: number): string => {
    if (count <= 1) {
      return "grid-cols-1";
    }
    if (count === 2) {
      return "grid-cols-1 md:grid-cols-2";
    }
    if (count <= 4) {
      return "grid-cols-1 sm:grid-cols-2";
    }
    return "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
  };

  const tileGridClass = useMemo(() => resolveGridClass(participantTiles.length), [participantTiles.length]);
  const screenShareTiles = useMemo(() => participantTiles.filter((tile) => Boolean(tile.screenStream)), [participantTiles]);
  const regularVoiceTiles = useMemo(() => participantTiles.filter((tile) => !tile.screenStream), [participantTiles]);
  const regularGridClass = useMemo(() => resolveGridClass(regularVoiceTiles.length), [regularVoiceTiles.length]);

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
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-paw-bg-primary">
      <div className="min-h-0 flex-1 p-3">
        {!connected ? (
          <div className="grid h-full place-items-center rounded-lg border border-white/10 bg-paw-bg-secondary">
            <div className="text-center">
              <p className="mb-2 text-sm text-paw-text-secondary">{t("server.voice_panel_hint")}</p>
              <button
                disabled={!channelId}
                className="rounded-md border border-white/10 bg-paw-accent px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-paw-accentSecondary disabled:cursor-not-allowed disabled:opacity-60"
                onClick={onConnect}
              >
                {t("voice.connect")}
              </button>
            </div>
          </div>
        ) : participantTiles.length === 0 ? (
          <div className="grid h-full place-items-center rounded-lg border border-white/10 bg-paw-bg-secondary">
            <p className="text-sm text-paw-text-muted">{t("voice.no_participants")}</p>
          </div>
        ) : screenShareTiles.length > 0 ? (
          <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            <div
              className={clsx(
                "grid gap-3",
                screenShareTiles.length === 1 ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-2",
              )}
            >
              {screenShareTiles.map(({ participant, name, isCurrentUser, isSpeaking, isSharingScreen, avatarSource }) => (
                <article
                  key={participant.user_id}
                  className={clsx(
                    "group relative min-h-[260px] overflow-hidden rounded-lg border bg-[#111214] md:min-h-[320px] xl:min-h-[360px]",
                    isSpeaking ? "border-[#43b581] shadow-[0_0_0_2px_rgba(67,181,129,0.35)]" : "border-white/10 hover:border-white/20",
                  )}
                >
                  <video
                    ref={(element) => {
                      videoRefs.current[participant.user_id] = element;
                    }}
                    autoPlay
                    playsInline
                    muted={isCurrentUser}
                    className="h-full w-full bg-black object-contain"
                  />

                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />

                  <div className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-1 text-xs font-semibold text-white">{name}</div>

                  {isSharingScreen ? (
                    <div className="absolute right-2 top-2 rounded-full border border-red-400/40 bg-red-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      {t("voice.live_badge")}
                    </div>
                  ) : null}

                  <button
                    onClick={() => setFullscreenUserId(participant.user_id)}
                    className="absolute right-2 bottom-2 rounded-md border border-white/20 bg-black/45 px-2 py-1 text-[11px] font-semibold text-white opacity-100 transition hover:bg-black/70"
                  >
                    {t("voice.expand_stream")}
                  </button>
                </article>
              ))}
            </div>

            {regularVoiceTiles.length > 0 ? (
              <div className={clsx("grid auto-rows-fr gap-3", regularGridClass)}>
                {regularVoiceTiles.map(({ participant, name, isSpeaking, avatarSource }) => (
                  <article
                    key={participant.user_id}
                    className={clsx(
                      "relative min-h-[160px] overflow-hidden rounded-lg border bg-[#2b2d31] transition-all duration-200",
                      isSpeaking ? "border-[#43b581] shadow-[0_0_0_2px_rgba(67,181,129,0.35)]" : "border-white/10 hover:border-white/20",
                    )}
                  >
                    <div className="relative grid h-full w-full place-items-center bg-[#2b2d31]">
                      <div className={clsx("rounded-full p-1.5", isSpeaking ? "ring-2 ring-[#43b581]" : "ring-1 ring-white/15")}>
                        <Avatar src={avatarSource} label={name} online={!participant.deafened} size="lg" />
                      </div>
                    </div>
                    <div className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-1 text-xs font-semibold text-white">{name}</div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className={clsx("grid h-full min-h-0 auto-rows-fr gap-3", tileGridClass)}>
            {participantTiles.map(({ participant, name, isCurrentUser, isSpeaking, isSharingScreen, avatarSource, screenStream }) => (
              <article
                key={participant.user_id}
                className={clsx(
                  "group relative min-h-[180px] overflow-hidden rounded-lg border bg-[#2b2d31] transition-all duration-200",
                  isSpeaking ? "border-[#43b581] shadow-[0_0_0_2px_rgba(67,181,129,0.35)]" : "border-white/10 hover:border-white/20",
                )}
              >
                {screenStream ? (
                  <video
                    ref={(element) => {
                      videoRefs.current[participant.user_id] = element;
                    }}
                    autoPlay
                    playsInline
                    muted={isCurrentUser}
                    className="h-full w-full bg-black object-contain"
                  />
                ) : (
                  <div className="relative grid h-full w-full place-items-center bg-[#2b2d31]">
                    <div className={clsx("rounded-full p-1.5", isSpeaking ? "ring-2 ring-[#43b581]" : "ring-1 ring-white/15")}>
                      <Avatar src={avatarSource} label={name} online={!participant.deafened} size="lg" />
                    </div>
                  </div>
                )}

                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />

                <div className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-1 text-xs font-semibold text-white">{name}</div>

                {isSharingScreen ? (
                  <div className="absolute right-2 top-2 rounded-full border border-red-400/40 bg-red-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    {t("voice.live_badge")}
                  </div>
                ) : null}

                {screenStream ? (
                  <button
                    onClick={() => setFullscreenUserId(participant.user_id)}
                    className="absolute right-2 bottom-2 rounded-md border border-white/20 bg-black/45 px-2 py-1 text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100"
                  >
                    {t("voice.expand_stream")}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-black/35 bg-paw-bg-secondary p-3">
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
      </div>

      {fullscreenUserId && fullscreenStream ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/95 p-3" onClick={() => setFullscreenUserId(null)}>
          <div className="relative h-full w-full max-w-[1800px]" onClick={(event) => event.stopPropagation()}>
            <button
              className="absolute right-3 top-3 z-10 rounded-md border border-white/15 bg-black/50 px-3 py-1.5 text-xs font-semibold text-white"
              onClick={() => setFullscreenUserId(null)}
            >
              {t("voice.fullscreen_close")}
            </button>
            <video ref={fullscreenVideoRef} autoPlay playsInline className="h-full w-full rounded-lg bg-black object-contain" />
          </div>
        </div>
      ) : null}
    </section>
  );
};
