import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router-dom";

import { useMeQuery } from "@/api/queries";
import { Avatar } from "@/components/ui/Avatar";
import { VoiceAvatarStateBadge, VoiceStateIndicators } from "@/components/voice/VoiceStateIndicators";
import { Button } from "@/components/ui/Button";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { GatewayConnectionStatus } from "@/hooks/useWebSocket";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import { useChannelStore } from "@/store/channelStore";
import { useMessageStore } from "@/store/messageStore";
import { useServerStore } from "@/store/serverStore";
import {
  LAYOUT_CHANNEL_LIST_DEFAULT_WIDTH,
  CHANNEL_LIST_WIDTH_STORAGE_KEY,
  clampChannelListWidth,
  readStoredChannelListWidth,
} from "@/theme/layout";
import type { VoiceParticipant } from "@/store/voiceStore";
import { useVoiceStore } from "@/store/voiceStore";
import type { Channel } from "@/types";

interface ChannelListProps {
  connectedVoiceChannelId: string | null;
  onJoinVoice: (channelId: string) => void;
  onLeaveVoice: () => void;
  onRenameChannel: (channelId: string) => void;
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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const hasMentionForCurrentUser = (content: string, userId: string | null, username: string | null): boolean => {
  if (!content || (!userId && !username)) {
    return false;
  }
  if (userId && content.includes(`<@${userId}>`)) {
    return true;
  }
  if (!username) {
    return false;
  }
  const matcher = new RegExp(`(^|\\W)@${escapeRegExp(username)}(?=$|\\W)`, "i");
  return matcher.test(content);
};

const HashIcon = () => (
  <svg className="h-[var(--icon-size-md)] w-[var(--icon-size-md)] shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M10 4L8 20M16 4L14 20M4 9H20M3 15H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const VoiceIcon = () => (
  <svg className="h-[var(--icon-size-md)] w-[var(--icon-size-md)] shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M5 8V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M9 6V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M13 4V20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M17 8V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const GearIcon = () => (
  <svg className="h-[var(--icon-size-sm)] w-[var(--icon-size-sm)] shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l1.69-1.32a.5.5 0 0 0 .12-.64l-1.6-2.77a.5.5 0 0 0-.6-.22l-1.99.8a7.23 7.23 0 0 0-1.63-.94l-.3-2.12A.5.5 0 0 0 14.34 3h-3.2a.5.5 0 0 0-.49.42l-.3 2.12c-.58.23-1.12.54-1.63.94l-1.99-.8a.5.5 0 0 0-.6.22L4.53 8.67a.5.5 0 0 0 .12.64l1.69 1.32c-.04.31-.06.62-.06.94s.02.63.06.94l-1.69 1.32a.5.5 0 0 0-.12.64l1.6 2.77c.14.24.42.34.68.24l1.99-.8c.51.4 1.05.72 1.63.94l.3 2.12c.04.24.25.42.49.42h3.2c.24 0 .45-.18.49-.42l.3-2.12c.58-.23 1.12-.54 1.63-.94l1.99.8c.26.1.54 0 .68-.24l1.6-2.77a.5.5 0 0 0-.12-.64l-1.69-1.32ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
      fill="currentColor"
    />
  </svg>
);

const sectionHeadingClass = "typo-meta px-2 font-semibold uppercase tracking-[0.04em]";
const channelRowBaseClass =
  "group flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left typo-body transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35";
const iconActionButtonClass =
  "grid h-6 w-6 place-items-center rounded-md border border-white/12 bg-black/25 text-paw-text-muted transition-colors ui-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35 disabled:cursor-not-allowed disabled:opacity-45";

export const ChannelList = ({
  connectedVoiceChannelId,
  onJoinVoice,
  onLeaveVoice,
  onRenameChannel,
  onCreateTextChannel,
  onCreateVoiceChannel,
  onInvite,
  onOpenServerSettings,
  canManageServer,
  isCreatingChannel,
  gatewayStatus,
  gatewayLatencyMs,
}: ChannelListProps) => {
  const { locale, t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const { data: meUser } = useMeQuery();
  const channels = useChannelStore((state) => state.channels);
  const activeChannelId = useChannelStore((state) => state.activeChannelId);
  const setActiveChannel = useChannelStore((state) => state.setActiveChannel);
  const messagesByChannel = useMessageStore((state) => state.byChannel);
  const servers = useServerStore((state) => state.servers);
  const activeServerId = useServerStore((state) => state.activeServerId);
  const participantsByChannel = useVoiceStore((state) => state.participantsByChannel);
  const [panelWidth, setPanelWidth] = useState<number>(() => readStoredChannelListWidth());
  const [recentlyConnectedChannelId, setRecentlyConnectedChannelId] = useState<string | null>(null);
  const resizeStateRef = useRef<{ active: boolean; startX: number; startWidth: number }>({
    active: false,
    startX: 0,
    startWidth: LAYOUT_CHANNEL_LIST_DEFAULT_WIDTH,
  });
  const previousConnectedVoiceChannelRef = useRef<string | null>(null);
  const connectAnimationTimeoutRef = useRef<number | null>(null);

  const [context, setContext] = useState<{ visible: boolean; x: number; y: number; channelId: string | null }>({
    visible: false,
    x: 0,
    y: 0,
    channelId: null,
  });

  const server = useMemo(() => servers.find((item) => item.id === activeServerId) ?? null, [servers, activeServerId]);
  const effectiveUser = user ?? meUser ?? null;
  const currentUserId = effectiveUser?.id ?? null;
  const currentUsername = effectiveUser?.username ?? null;
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
  const selectedTextChannelForSettings = useMemo(() => {
    const activeTextChannel = channels.find((item) => item.id === activeChannelId && item.type !== "voice");
    if (activeTextChannel) {
      return activeTextChannel;
    }
    return textChannels[0] ?? null;
  }, [activeChannelId, channels, textChannels]);
  const selectedVoiceChannelForSettings = useMemo(() => {
    const activeVoiceChannel = channels.find((item) => item.id === activeChannelId && item.type === "voice");
    if (activeVoiceChannel) {
      return activeVoiceChannel;
    }
    return voiceChannels[0] ?? null;
  }, [activeChannelId, channels, voiceChannels]);

  const handleResizeMove = useCallback((event: PointerEvent) => {
    const state = resizeStateRef.current;
    if (!state.active) {
      return;
    }
    const deltaX = event.clientX - state.startX;
    setPanelWidth(clampChannelListWidth(state.startWidth + deltaX));
  }, []);

  const stopResize = useCallback(() => {
    if (!resizeStateRef.current.active) {
      return;
    }
    resizeStateRef.current.active = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("pointermove", handleResizeMove);
    window.removeEventListener("pointerup", stopResize);
  }, [handleResizeMove]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      resizeStateRef.current.active = true;
      resizeStateRef.current.startX = event.clientX;
      resizeStateRef.current.startWidth = panelWidth;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      window.addEventListener("pointermove", handleResizeMove);
      window.addEventListener("pointerup", stopResize);
    },
    [handleResizeMove, panelWidth, stopResize],
  );

  useEffect(() => {
    window.localStorage.setItem(CHANNEL_LIST_WIDTH_STORAGE_KEY, String(Math.round(panelWidth)));
  }, [panelWidth]);

  useEffect(() => {
    return () => {
      stopResize();
    };
  }, [stopResize]);

  useEffect(() => {
    const previousChannelId = previousConnectedVoiceChannelRef.current;
    if (connectedVoiceChannelId && previousChannelId !== connectedVoiceChannelId) {
      setRecentlyConnectedChannelId(connectedVoiceChannelId);
      if (connectAnimationTimeoutRef.current !== null) {
        window.clearTimeout(connectAnimationTimeoutRef.current);
      }
      connectAnimationTimeoutRef.current = window.setTimeout(() => {
        setRecentlyConnectedChannelId((value) => (value === connectedVoiceChannelId ? null : value));
        connectAnimationTimeoutRef.current = null;
      }, 780);
    }
    if (!connectedVoiceChannelId) {
      setRecentlyConnectedChannelId(null);
    }
    previousConnectedVoiceChannelRef.current = connectedVoiceChannelId;
  }, [connectedVoiceChannelId]);

  useEffect(() => {
    return () => {
      if (connectAnimationTimeoutRef.current !== null) {
        window.clearTimeout(connectAnimationTimeoutRef.current);
      }
    };
  }, []);

  const actions = useMemo(
    () => [
      {
        id: "rename",
        label: t("channels.action_rename"),
        onClick: () => {
          if (context.channelId) {
            onRenameChannel(context.channelId);
          }
          setContext((value) => ({ ...value, visible: false }));
        },
      },
      {
        id: "mute",
        label: t("channels.action_mute"),
        onClick: () => setContext((value) => ({ ...value, visible: false })),
      },
    ],
    [context.channelId, onRenameChannel, t],
  );

  const renderVoiceChannel = (channel: Channel) => {
    const active = activeChannelId === channel.id;
    const connected = connectedVoiceChannelId === channel.id;
    const justConnected = recentlyConnectedChannelId === channel.id;
    const channelParticipants = voiceParticipantsByChannel[channel.id] ?? [];

    return (
      <div
        key={channel.id}
        className={`rounded-md ${justConnected ? "voice-channel-join-animate" : ""}`}
        onContextMenu={(event) => {
          event.preventDefault();
          setContext({ visible: true, x: event.clientX, y: event.clientY, channelId: channel.id });
        }}
      >
        <div className={`${channelRowBaseClass} ${active ? "ui-state-active" : "text-paw-text-muted ui-state-hover"}`}>
          <button
            className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
            onClick={() => setActiveChannel(channel.id)}
          >
            <span>
              <VoiceIcon />
            </span>
            <span className="truncate">{channel.name}</span>
          </button>

          <button
            className={`rounded px-2 py-0.5 typo-meta font-semibold tracking-[0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35 ${
              connected ? "bg-[#248046] text-white hover:bg-[#2a9351]" : "bg-[#41434a] text-paw-text-secondary hover:bg-[#282d36] hover:text-white"
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
          <div className="ml-6 mt-1 space-y-0.5 border-l border-white/10 pl-2">
            {channelParticipants.map((participant) => {
              const isSelf = participant.user_id === effectiveUser?.id;
              const name = toParticipantName(participant, effectiveUser?.id ?? null, effectiveUser?.username ?? null);
              const youLabelRaw = t("voice.you");
              const youLabel = typeof youLabelRaw === "string" && youLabelRaw.trim().length > 0 ? youLabelRaw : locale === "ru" ? "Р’С‹" : "you";
              return (
                <div
                  key={`${channel.id}-${participant.user_id}`}
                  className="flex h-9 items-center gap-2.5 rounded-md px-1.5 typo-body text-paw-text-secondary transition-colors hover:bg-white/10"
                >
                  <span className="relative inline-flex">
                    <Avatar src={participant.avatar_url ?? null} label={name} size="md" online={!participant.muted && !participant.deafened} />
                    <VoiceAvatarStateBadge size="md" muted={participant.muted} deafened={participant.deafened} />
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate">
                      {name}
                      {isSelf ? ` (${youLabel})` : ""}
                    </span>
                    <VoiceStateIndicators className="shrink-0" muted={participant.muted} deafened={participant.deafened} />
                  </span>
                  {participant.screen_sharing ? (
                    <span className="rounded bg-[#da373c] px-1.5 py-0.5 typo-meta font-semibold uppercase tracking-wide text-white">
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
    <section className="relative flex h-full shrink-0 flex-col border-r border-black/35 bg-paw-bg-secondary" style={{ width: `${panelWidth}px` }}>
      <header className="relative h-[var(--layout-server-hero-height)] overflow-hidden border-b border-black/35 shadow-[0_1px_0_rgba(255,255,255,0.02)]">
        <div className="absolute inset-0">
          {server?.banner_url ? (
            <img src={server.banner_url} alt={server?.name ?? "Server"} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-[radial-gradient(110%_90%_at_10%_10%,rgba(95,120,255,0.35),transparent_55%),radial-gradient(80%_80%_at_100%_0%,rgba(80,220,170,0.24),transparent_60%),linear-gradient(180deg,#1b2234_0%,#131722_100%)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-[#11131a]/95" />
        </div>

        <div className="relative flex h-full flex-col justify-end gap-2 px-3 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar src={server?.icon_url ?? null} label={server?.name ?? "Server"} size="sm" />
            <h2 className="typo-title-md truncate text-white">{server?.name ?? "Server"}</h2>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onInvite}
              className="h-7 rounded-md border border-white/15 bg-black/35 px-2.5 typo-meta font-semibold text-paw-text-secondary backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35"
            >
              {t("server.invite_button")}
            </button>
            {canManageServer ? (
              <button
                type="button"
                title={t("server.settings_button")}
                aria-label={t("server.settings_button")}
                onClick={onOpenServerSettings}
                className="grid h-7 w-7 place-items-center rounded-md border border-white/15 bg-black/35 text-paw-text-secondary backdrop-blur-sm transition-colors hover:bg-black/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35"
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

      <div className="min-h-0 flex-1 space-y-[var(--layout-section-gap)] overflow-y-auto px-2 py-3" onClick={() => setContext((value) => ({ ...value, visible: false }))}>
        <div>
          <div className="flex items-center justify-between px-2">
            <p className={sectionHeadingClass}>{t("channels.text_channels")}</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title={t("channels.channel_settings")}
                aria-label={t("channels.channel_settings")}
                disabled={!canManageServer || !selectedTextChannelForSettings}
                onClick={() => {
                  if (selectedTextChannelForSettings) {
                    onRenameChannel(selectedTextChannelForSettings.id);
                  }
                }}
                className={iconActionButtonClass}
              >
                <GearIcon />
              </button>
              <button
                type="button"
                title={t("channels.create_text_channel")}
                aria-label={t("channels.create_text_channel")}
                disabled={isCreatingChannel}
                onClick={onCreateTextChannel}
                className={iconActionButtonClass}
              >
                <span className="text-[16px] font-semibold leading-none">+</span>
              </button>
            </div>
          </div>
          <div className="mt-1 space-y-0.5">
            {textChannels.length === 0 ? <p className="typo-meta px-2 py-1">{t("channels.empty")}</p> : null}
             {textChannels.map((channel) => {
               const active = activeChannelId === channel.id;
               const channelMessages = messagesByChannel[channel.id] ?? [];
               const unreadMessages =
                 currentUserId !== null
                   ? channelMessages.filter((message) => message.author_id !== currentUserId && !(message.read_by ?? []).includes(currentUserId))
                   : [];
               const unreadCount = active ? 0 : unreadMessages.length;
               const unreadLabel = unreadCount > 99 ? "99+" : `${unreadCount}`;
               const hasMentionInUnread = unreadMessages.some((message) =>
                 hasMentionForCurrentUser(message.content, currentUserId, currentUsername),
               );
               const rowStateClass = !active ? (hasMentionInUnread ? "ui-state-mention" : unreadCount > 0 ? "ui-state-unread" : "") : "";
               return (
                 <button
                   key={channel.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContext({ visible: true, x: event.clientX, y: event.clientY, channelId: channel.id });
                  }}
                  onClick={() => setActiveChannel(channel.id)}
                   className={`${channelRowBaseClass} relative ${rowStateClass} ${active ? "ui-state-active" : "text-paw-text-muted ui-state-hover"}`}
                 >
                   {!active && hasMentionInUnread ? <span className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-[#f0b232]" /> : null}
                   {!active && !hasMentionInUnread && unreadCount > 0 ? <span className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-[#7b85ff]" /> : null}
                   <span className="text-paw-text-muted">
                     <HashIcon />
                   </span>
                   <span className="truncate">{channel.name}</span>
                   {hasMentionInUnread ? (
                     <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f0b232] px-1.5 text-[11px] font-bold leading-none text-[#1a1f22]">
                       @
                     </span>
                   ) : unreadCount > 0 ? (
                     <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#3b82f6] px-1.5 text-[11px] font-bold leading-none text-white">
                       {unreadLabel}
                     </span>
                   ) : null}
                 </button>
               );
             })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between px-2">
            <p className={sectionHeadingClass}>{t("channels.voice_channels")}</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title={t("channels.channel_settings")}
                aria-label={t("channels.channel_settings")}
                disabled={!canManageServer || !selectedVoiceChannelForSettings}
                onClick={() => {
                  if (selectedVoiceChannelForSettings) {
                    onRenameChannel(selectedVoiceChannelForSettings.id);
                  }
                }}
                className={iconActionButtonClass}
              >
                <GearIcon />
              </button>
              <button
                type="button"
                title={t("channels.create_voice_channel")}
                aria-label={t("channels.create_voice_channel")}
                disabled={isCreatingChannel}
                onClick={onCreateVoiceChannel}
                className={iconActionButtonClass}
              >
                <span className="text-[16px] font-semibold leading-none">+</span>
              </button>
            </div>
          </div>
          <div className="mt-1 space-y-0.5">
            {voiceChannels.length === 0 ? <p className="typo-meta px-2 py-1">{t("channels.empty")}</p> : null}
            {voiceChannels.map((channel) => renderVoiceChannel(channel))}
          </div>
        </div>
      </div>

      <footer className="border-t border-black/35 bg-paw-bg-elevated px-2 py-2">
        {connectedVoiceChannelId ? (
          <div
            className={`mb-2 rounded-lg border border-[#248046]/35 bg-[#1a2d1f] px-2 py-2 ${
              recentlyConnectedChannelId === connectedVoiceChannelId ? "voice-connected-card-enter" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="typo-meta truncate font-semibold text-[#8ee6a8]">{t("voice.connected")}</p>
              <span
                className={`rounded-full border px-2 py-0.5 typo-meta font-semibold uppercase tracking-wide ${
                  gatewayStatus === "connected"
                    ? "border-[#248046]/35 bg-[#248046]/25 text-[#8ee6a8]"
                    : gatewayStatus === "reconnecting" || gatewayStatus === "connecting"
                      ? "border-[#f4b942]/35 bg-[#f4b942]/20 text-[#ffd890]"
                      : "border-white/15 bg-[#0f1116] text-paw-text-muted"
                }`}
              >
                {gatewayStatusLabel}
              </span>
            </div>
            <p className="typo-meta mt-1 truncate text-paw-text-secondary">
              #{connectedVoiceChannel?.name ?? t("voice.title")}
              {server?.name ? ` / ${server.name}` : ""}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="typo-meta text-paw-text-muted">
                Ping: {gatewayLatencyMs !== null ? `${Math.round(gatewayLatencyMs)} ms` : "-"}
              </p>
              <button
                type="button"
                onClick={onLeaveVoice}
                className="rounded-md border border-white/15 bg-[#0f1116] px-2 py-0.5 typo-meta font-semibold text-paw-text-secondary transition-colors hover:bg-[#171a20] hover:text-paw-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35"
              >
                {t("voice.leave")}
              </button>
            </div>
          </div>
        ) : null}

        <div className="ui-profile-card p-2">
          <div className="flex items-center gap-2">
            <Avatar src={effectiveUser?.avatar_url ?? null} label={effectiveUser?.username ?? "guest"} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="ui-profile-name typo-body truncate font-semibold">{effectiveUser?.username ?? "guest"}</p>
              <p className="typo-meta truncate">{effectiveUser?.id?.slice(0, 8) ?? t("common.none")}</p>
            </div>
          </div>

          <div className="mt-2">
            <Link to="/app/settings" className="block w-full">
              <Button variant="secondary" size="sm" className="ui-profile-card-btn w-full">
                {t("home.settings")}
              </Button>
            </Link>
          </div>
        </div>
      </footer>

      <ContextMenu visible={context.visible} x={context.x} y={context.y} actions={actions} />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize channels panel"
        onPointerDown={startResize}
        className="absolute inset-y-0 right-0 z-30 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-white/10"
      />
    </section>
  );
};

