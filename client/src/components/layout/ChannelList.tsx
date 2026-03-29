import { useMemo, useState } from "react";

import { useMeQuery } from "@/api/queries";
import { Avatar } from "@/components/ui/Avatar";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { GatewayConnectionStatus } from "@/hooks/useWebSocket";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import { useChannelStore } from "@/store/channelStore";
import { useServerStore } from "@/store/serverStore";
import type { VoiceParticipant } from "@/store/voiceStore";
import { useVoiceStore } from "@/store/voiceStore";
import type { Channel } from "@/types";

interface ChannelListProps {
  connectedVoiceChannelId: string | null;
  onJoinVoice: (channelId: string) => void;
  onLeaveVoice: () => void;
  onCreateTextChannel: () => void;
  onCreateVoiceChannel: () => void;
  onInvite: () => void;
  onOpenServerSettings: () => void;
  canManageServer: boolean;
  isCreatingChannel: boolean;
  gatewayStatus: GatewayConnectionStatus;
  gatewayLatencyMs: number | null;
}

const toParticipantName = (participant: VoiceParticipant, currentUserId: string | null, currentUsername: string | null): string => {
  if (participant.user_id === currentUserId && currentUsername) {
    return currentUsername;
  }
  if (typeof participant.username === "string" && participant.username.trim().length > 0) {
    return participant.username;
  }
  return `user-${participant.user_id.slice(0, 6)}`;
};

const HashIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M10 4L8 20M16 4L14 20M4 9H20M3 15H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const VoiceIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M5 8V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M9 6V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M13 4V20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M17 8V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const ChannelList = ({
  connectedVoiceChannelId,
  onJoinVoice,
  onLeaveVoice,
  onCreateTextChannel,
  onCreateVoiceChannel,
  onInvite,
  onOpenServerSettings,
  canManageServer,
  isCreatingChannel,
  gatewayStatus,
  gatewayLatencyMs,
}: ChannelListProps) => {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const { data: meUser } = useMeQuery();
  const channels = useChannelStore((state) => state.channels);
  const activeChannelId = useChannelStore((state) => state.activeChannelId);
  const setActiveChannel = useChannelStore((state) => state.setActiveChannel);
  const servers = useServerStore((state) => state.servers);
  const activeServerId = useServerStore((state) => state.activeServerId);
  const participantsByChannel = useVoiceStore((state) => state.participantsByChannel);

  const [context, setContext] = useState<{ visible: boolean; x: number; y: number; channelId: string | null }>({
    visible: false,
    x: 0,
    y: 0,
    channelId: null,
  });

  const server = useMemo(() => servers.find((item) => item.id === activeServerId) ?? null, [servers, activeServerId]);
  const effectiveUser = user ?? meUser ?? null;
  const textChannels = useMemo(() => channels.filter((item) => item.type !== "voice"), [channels]);
  const voiceChannels = useMemo(() => channels.filter((item) => item.type === "voice"), [channels]);
  const voiceParticipantsByChannel = useMemo(() => {
    const next: Record<string, VoiceParticipant[]> = {};
    for (const channel of voiceChannels) {
      const byUser = new Map<string, VoiceParticipant>();
      const channelParticipants = participantsByChannel[channel.id] ?? [];
      for (const participant of channelParticipants) {
        byUser.set(participant.user_id, participant);
      }
      const sorted = Array.from(byUser.values()).sort((left, right) => {
        if (left.user_id === effectiveUser?.id) {
          return -1;
        }
        if (right.user_id === effectiveUser?.id) {
          return 1;
        }
        const leftName = toParticipantName(left, effectiveUser?.id ?? null, effectiveUser?.username ?? null);
        const rightName = toParticipantName(right, effectiveUser?.id ?? null, effectiveUser?.username ?? null);
        return leftName.localeCompare(rightName);
      });
      next[channel.id] = sorted;
    }
    return next;
  }, [effectiveUser?.id, effectiveUser?.username, participantsByChannel, voiceChannels]);
  const gatewayStatusLabel = useMemo(() => {
    if (gatewayStatus === "connected") {
      return t("voice.connected");
    }
    if (gatewayStatus === "connecting") {
      return "Connecting";
    }
    if (gatewayStatus === "reconnecting") {
      return "Reconnecting";
    }
    return t("voice.not_connected");
  }, [gatewayStatus, t]);
  const connectedVoiceChannel = useMemo(() => {
    if (!connectedVoiceChannelId) {
      return null;
    }
    return channels.find((item) => item.id === connectedVoiceChannelId) ?? null;
  }, [channels, connectedVoiceChannelId]);

  const actions = useMemo(
    () => [
      {
        id: "rename",
        label: t("channels.action_rename"),
        onClick: () => setContext((value) => ({ ...value, visible: false })),
      },
      {
        id: "mute",
        label: t("channels.action_mute"),
        onClick: () => setContext((value) => ({ ...value, visible: false })),
      },
    ],
    [t],
  );

  const renderVoiceChannel = (channel: Channel) => {
    const active = activeChannelId === channel.id;
    const connected = connectedVoiceChannelId === channel.id;
    const channelParticipants = voiceParticipantsByChannel[channel.id] ?? [];

    return (
      <div key={channel.id} className="rounded-lg">
        <div
          className={`group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[14px] transition-all duration-150 ${
            active
              ? "bg-paw-bg-elevated text-paw-text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
              : "text-paw-text-muted hover:bg-paw-bg-elevated/70 hover:text-paw-text-secondary"
          }`}
        >
          <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setActiveChannel(channel.id)}>
            <span>
              <VoiceIcon />
            </span>
            <span className="truncate">{channel.name}</span>
          </button>

          <button
            className={`rounded-md px-2 py-0.5 text-xs font-medium transition-colors ${
              connected ? "bg-[#3ba55d] text-white hover:bg-[#43b967]" : "bg-white/10 text-paw-text-secondary hover:bg-white/15 hover:text-white"
            }`}
            onClick={() => {
              if (connected) {
                onLeaveVoice();
              } else {
                onJoinVoice(channel.id);
              }
            }}
          >
            {connected ? t("channels.leave_voice") : t("channels.join_voice")}
          </button>
        </div>

        {channelParticipants.length > 0 ? (
          <div className="ml-6 mt-1 space-y-1 border-l border-white/10 pl-2">
            {channelParticipants.map((participant) => {
              const isSelf = participant.user_id === effectiveUser?.id;
              const name = toParticipantName(participant, effectiveUser?.id ?? null, effectiveUser?.username ?? null);
              return (
                <div
                  key={`${channel.id}-${participant.user_id}`}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-paw-text-secondary transition-colors hover:bg-white/5"
                >
                  <Avatar src={participant.avatar_url ?? null} label={name} size="sm" online={!participant.deafened} />
                  <span className="min-w-0 flex-1 truncate">
                    {name}
                    {isSelf ? ` (${t("voice.you")})` : ""}
                  </span>
                  {participant.screen_sharing ? (
                    <span className="rounded bg-[#da373c] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      {t("voice.live_badge")}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="flex h-full w-60 flex-col border-r border-white/10 bg-black/20 backdrop-blur-sm">
      <header className="h-12 border-b border-white/10 px-4">
        <div className="flex h-full items-center">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[15px] font-semibold text-paw-text-primary">{server?.name ?? "Server"}</h2>
            <button
              type="button"
              onClick={onInvite}
              className="rounded-md border border-white/14 bg-black/25 px-2.5 py-1 text-xs font-semibold text-paw-text-secondary transition hover:border-white/22 hover:bg-black/35 hover:text-paw-text-primary"
            >
              {t("server.invite_button")}
            </button>
            {canManageServer ? (
              <button
                type="button"
                title={t("server.settings_button")}
                aria-label={t("server.settings_button")}
                onClick={onOpenServerSettings}
                className="grid h-7 w-7 place-items-center rounded-md border border-white/14 bg-black/25 text-paw-text-secondary transition hover:border-white/22 hover:bg-black/35 hover:text-paw-text-primary"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
                  <path
                    d="M10.325 4.317a1 1 0 0 1 1.35-.936l.887.355a1 1 0 0 0 .876-.03l.85-.425a1 1 0 0 1 1.325.486l.41.82a1 1 0 0 0 .687.53l.908.181a1 1 0 0 1 .79 1.16l-.15.914a1 1 0 0 0 .22.848l.602.704a1 1 0 0 1 0 1.302l-.602.704a1 1 0 0 0-.22.848l.15.914a1 1 0 0 1-.79 1.16l-.908.182a1 1 0 0 0-.687.53l-.41.82a1 1 0 0 1-1.325.486l-.85-.426a1 1 0 0 0-.876-.03l-.887.355a1 1 0 0 1-1.35-.936v-.955a1 1 0 0 0-.493-.863l-.83-.488a1 1 0 0 1-.366-1.366l.488-.83a1 1 0 0 0 0-1.006l-.488-.83a1 1 0 0 1 .366-1.366l.83-.488a1 1 0 0 0 .493-.863v-.955Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="2.25" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3" onClick={() => setContext((value) => ({ ...value, visible: false }))}>
        <div>
          <div className="flex items-center justify-between px-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-paw-text-muted">{t("channels.text_channels")}</p>
            <button
              type="button"
              title={t("channels.create_text_channel")}
              aria-label={t("channels.create_text_channel")}
              disabled={isCreatingChannel}
              onClick={onCreateTextChannel}
              className="grid h-5 w-5 place-items-center rounded text-sm leading-none text-paw-text-muted transition hover:bg-white/10 hover:text-paw-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              +
            </button>
          </div>
          <div className="mt-1 space-y-0.5">
            {textChannels.length === 0 ? <p className="px-2 py-1 text-xs text-paw-text-muted">{t("channels.empty")}</p> : null}
            {textChannels.map((channel) => {
              const active = activeChannelId === channel.id;
              return (
                <button
                  key={channel.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContext({ visible: true, x: event.clientX, y: event.clientY, channelId: channel.id });
                  }}
                  onClick={() => setActiveChannel(channel.id)}
                  className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[15px] transition-all duration-150 ${
                    active
                      ? "bg-paw-bg-elevated text-paw-text-primary shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                      : "text-paw-text-muted hover:bg-paw-bg-elevated/70 hover:text-paw-text-secondary hover:translate-x-[1px]"
                  }`}
                >
                  <span className="text-paw-text-muted">
                    <HashIcon />
                  </span>
                  <span className="truncate">{channel.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between px-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-paw-text-muted">{t("channels.voice_channels")}</p>
            <button
              type="button"
              title={t("channels.create_voice_channel")}
              aria-label={t("channels.create_voice_channel")}
              disabled={isCreatingChannel}
              onClick={onCreateVoiceChannel}
              className="grid h-5 w-5 place-items-center rounded text-sm leading-none text-paw-text-muted transition hover:bg-white/10 hover:text-paw-text-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              +
            </button>
          </div>
          <div className="mt-1 space-y-0.5">
            {voiceChannels.length === 0 ? <p className="px-2 py-1 text-xs text-paw-text-muted">{t("channels.empty")}</p> : null}
            {voiceChannels.map((channel) => renderVoiceChannel(channel))}
          </div>
        </div>
      </div>

      <footer className="border-t border-white/10 bg-black/20 px-2 py-2">
        {connectedVoiceChannelId ? (
          <div className="mb-2 rounded-lg border border-[#3ba55d]/35 bg-[#1a2b22] px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-semibold text-[#9cf5ba]">{t("voice.connected")}</p>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  gatewayStatus === "connected"
                    ? "border-[#3ba55d]/35 bg-[#3ba55d]/20 text-[#9cf5ba]"
                    : gatewayStatus === "reconnecting" || gatewayStatus === "connecting"
                      ? "border-[#f4b942]/35 bg-[#f4b942]/20 text-[#ffd890]"
                      : "border-white/15 bg-black/20 text-paw-text-muted"
                }`}
              >
                {gatewayStatusLabel}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-paw-text-secondary">
              #{connectedVoiceChannel?.name ?? t("voice.title")}
              {server?.name ? ` / ${server.name}` : ""}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11px] text-paw-text-muted">
                Ping: {gatewayLatencyMs !== null ? `${Math.round(gatewayLatencyMs)} ms` : "—"}
              </p>
              <button
                type="button"
                onClick={onLeaveVoice}
                className="rounded-md border border-white/15 bg-black/30 px-2 py-0.5 text-[11px] font-semibold text-paw-text-secondary transition hover:bg-black/45 hover:text-paw-text-primary"
              >
                {t("voice.leave")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-2">
          <Avatar src={effectiveUser?.avatar_url ?? null} label={effectiveUser?.username ?? "guest"} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-paw-text-secondary">{effectiveUser?.username ?? "guest"}</p>
            <p className="truncate text-xs text-paw-text-muted">{effectiveUser?.id?.slice(0, 8) ?? t("common.none")}</p>
          </div>
        </div>
      </footer>

      <ContextMenu visible={context.visible} x={context.x} y={context.y} actions={actions} />
    </section>
  );
};
