import { useMemo } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";

import { useDirectChannelsQuery } from "@/api/queries";
import { Tooltip } from "@/components/ui/Tooltip";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import { useMessageStore } from "@/store/messageStore";
import { useServerStore } from "@/store/serverStore";
import type { VoiceParticipant } from "@/store/voiceStore";
import { useVoiceStore } from "@/store/voiceStore";
import type { Message } from "@/types";
import zcordLogo from "../../../animal.png";

const homeItemBase =
  "relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35";
const serverItemBase =
  "relative grid h-[52px] w-[52px] shrink-0 place-items-center overflow-hidden rounded-2xl text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35";

const VoiceTooltipIcon = () => (
  <svg className="h-[var(--icon-size-md)] w-[var(--icon-size-md)]" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M5 8V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M9 6V18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M13 4V20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M17 8V16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const getVoiceMemberName = (participant: VoiceParticipant): string => {
  if (typeof participant.username === "string" && participant.username.trim().length > 0) {
    return participant.username;
  }
  return `user-${participant.user_id.slice(0, 6)}`;
};

interface UnreadChannelSummary {
  channelId: string;
  channelName: string;
  count: number;
}

interface UnreadServerSummary {
  total: number;
  channels: UnreadChannelSummary[];
}

const getUnreadCountForChannel = (messages: Message[], currentUserId: string | null): number => {
  if (!currentUserId || messages.length === 0) {
    return 0;
  }
  let unreadCount = 0;
  for (const message of messages) {
    if (message.author_id === currentUserId) {
      continue;
    }
    const readBy = Array.isArray(message.read_by) ? message.read_by : [];
    if (!readBy.includes(currentUserId)) {
      unreadCount += 1;
    }
  }
  return unreadCount;
};

const getFallbackServerId = (messages: Message[]): string | null => {
  for (const message of messages) {
    if (typeof message.server_id === "string" && message.server_id.trim().length > 0) {
      return message.server_id;
    }
  }
  return null;
};

export const Sidebar = () => {
  const { t } = useI18n();
  const location = useLocation();
  const routeServerId = location.pathname.startsWith("/app/server/") ? location.pathname.replace("/app/server/", "") : null;

  const servers = useServerStore((state) => state.servers);
  const activeServerId = useServerStore((state) => state.activeServerId);
  const setActiveServer = useServerStore((state) => state.setActiveServer);
  const participantsByChannel = useVoiceStore((state) => state.participantsByChannel);
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const messagesByChannel = useMessageStore((state) => state.byChannel);
  const { data: knownChannels } = useDirectChannelsQuery();

  const homeActive = location.pathname.startsWith("/app/home");
  const voiceMembersByServer = useMemo(() => {
    const byServer = new Map<string, Map<string, VoiceParticipant>>();

    for (const channelParticipants of Object.values(participantsByChannel)) {
      for (const participant of channelParticipants) {
        if (typeof participant.server_id !== "string" || participant.server_id.trim().length === 0) {
          continue;
        }
        const serverId = participant.server_id;
        if (!byServer.has(serverId)) {
          byServer.set(serverId, new Map<string, VoiceParticipant>());
        }
        byServer.get(serverId)?.set(participant.user_id, participant);
      }
    }

    const result: Record<string, VoiceParticipant[]> = {};
    for (const [serverId, membersMap] of byServer.entries()) {
      result[serverId] = Array.from(membersMap.values()).sort((left, right) =>
        getVoiceMemberName(left).localeCompare(getVoiceMemberName(right)),
      );
    }
    return result;
  }, [participantsByChannel]);

  const { unreadByServer, unreadDmCount } = useMemo(() => {
    const channelMetaById = new Map<string, { name: string; serverId: string | null }>();
    for (const channel of knownChannels ?? []) {
      channelMetaById.set(channel.id, {
        name: channel.name,
        serverId: channel.server_id,
      });
    }

    const nextUnreadByServer: Record<string, UnreadServerSummary> = {};
    let nextUnreadDmCount = 0;

    for (const [channelId, channelMessages] of Object.entries(messagesByChannel)) {
      const unreadCount = getUnreadCountForChannel(channelMessages, currentUserId);
      if (unreadCount <= 0) {
        continue;
      }

      const knownMeta = channelMetaById.get(channelId);
      const serverId = knownMeta?.serverId ?? getFallbackServerId(channelMessages);
      const channelName = knownMeta?.name?.trim() ? knownMeta.name : `channel-${channelId.slice(0, 6)}`;

      if (!serverId) {
        nextUnreadDmCount += unreadCount;
        continue;
      }

      if (!nextUnreadByServer[serverId]) {
        nextUnreadByServer[serverId] = { total: 0, channels: [] };
      }

      nextUnreadByServer[serverId].total += unreadCount;
      nextUnreadByServer[serverId].channels.push({ channelId, channelName, count: unreadCount });
    }

    for (const summary of Object.values(nextUnreadByServer)) {
      summary.channels.sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.channelName.localeCompare(right.channelName);
      });
    }

    return {
      unreadByServer: nextUnreadByServer,
      unreadDmCount: nextUnreadDmCount,
    };
  }, [currentUserId, knownChannels, messagesByChannel]);

  const unreadDmLabel = unreadDmCount > 99 ? "99+" : `${unreadDmCount}`;

  return (
    <aside className="flex h-full w-[var(--layout-sidebar-width)] flex-col items-center gap-2 border-r border-black/35 bg-paw-bg-tertiary py-3">
      <Tooltip label="Home" side="right">
        <Link to="/app/home" onClick={() => setActiveServer(null)}>
          <motion.div
            className={homeItemBase}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            style={{ backgroundColor: homeActive ? "var(--color-accent-primary)" : "transparent", color: "var(--color-text-primary)" }}
          >
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-black/20 p-1">
              <img src={zcordLogo} alt="zcord" className="block h-full w-full object-contain" />
            </span>
            {homeActive ? <span className="absolute -left-[11px] h-5 w-1 rounded-r-full bg-white" /> : null}
            {unreadDmCount > 0 ? (
              <span className="pointer-events-none absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-paw-accent px-1.5 text-[11px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--color-bg-tertiary)]">
                {unreadDmLabel}
              </span>
            ) : null}
          </motion.div>
        </Link>
      </Tooltip>

      <div className="h-px w-8 bg-white/8" />

      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto pb-2">
        {servers.map((server) => {
          const active = server.id === activeServerId || server.id === routeServerId;
          const serverVoiceMembers = voiceMembersByServer[server.id] ?? [];
          const unreadSummary = unreadByServer[server.id];
          const unreadCount = unreadSummary?.total ?? 0;
          const unreadLabel = unreadCount > 99 ? "99+" : `${unreadCount}`;
          const unreadChannelPreview = unreadSummary?.channels.slice(0, 3) ?? [];
          const hiddenUnreadChannels = Math.max(0, (unreadSummary?.channels.length ?? 0) - unreadChannelPreview.length);
          const previewVoiceMembers = serverVoiceMembers.slice(0, 4);
          const hiddenVoiceMembersCount = Math.max(0, serverVoiceMembers.length - previewVoiceMembers.length);
          const tooltipContent = (
              <div className="w-[180px]">
                <div className="typo-meta truncate font-semibold text-paw-text-primary">{server.name}</div>
                {unreadCount > 0 ? (
                  <div className="mt-1.5 border-t border-white/10 pt-1.5">
                    <p className="typo-meta font-semibold text-paw-text-secondary">{t("home.unread_messages", { count: unreadCount })}</p>
                    <div className="mt-1 space-y-1">
                      {unreadChannelPreview.map((item) => {
                        const unreadChannelLabel = item.count > 99 ? "99+" : `${item.count}`;
                        return (
                          <div key={item.channelId} className="flex items-center justify-between gap-2">
                            <p className="typo-meta truncate text-paw-text-secondary">#{item.channelName}</p>
                            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-paw-accent px-1.5 text-[10px] font-semibold leading-none text-white">
                              {unreadChannelLabel}
                            </span>
                          </div>
                        );
                      })}
                      {hiddenUnreadChannels > 0 ? (
                        <p className="typo-meta text-paw-text-muted">+{hiddenUnreadChannels}</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {serverVoiceMembers.length > 0 ? (
                <>
                  <div className={`flex items-center gap-2 ${unreadCount > 0 ? "mt-2" : "mt-1.5"}`}>
                    <span className="grid h-6 w-6 place-items-center rounded-md border border-white/15 bg-white/10 text-paw-text-secondary">
                      <VoiceTooltipIcon />
                    </span>
                    <div className="flex min-w-0 items-center -space-x-1.5">
                      {previewVoiceMembers.map((participant) => {
                        const name = getVoiceMemberName(participant);
                        return (
                          <span
                            key={participant.user_id}
                            className="inline-flex h-6 w-6 overflow-hidden rounded-full border border-[#111318] bg-[#171a20]"
                            title={name}
                          >
                            {participant.avatar_url ? (
                              <img src={participant.avatar_url} alt={name} className="h-full w-full object-cover" />
                            ) : (
                              <span className="grid h-full w-full place-items-center text-[10px] font-semibold text-paw-text-primary">
                                {name.slice(0, 1).toUpperCase()}
                              </span>
                            )}
                          </span>
                        );
                      })}
                      {hiddenVoiceMembersCount > 0 ? (
                        <span className="ml-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-white/15 bg-[#171a20] px-1 text-[10px] font-semibold leading-4 text-paw-text-secondary">
                          +{hiddenVoiceMembersCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <div className="typo-meta mt-1.5 text-paw-text-muted">{t("sidebar.voice_empty")}</div>
              )}
            </div>
          );

          return (
            <Tooltip key={server.id} content={tooltipContent} side="right" popupClassName="px-2.5 py-2">
              <Link to={`/app/server/${server.id}`} onClick={() => setActiveServer(server.id)}>
                <motion.div
                  className={serverItemBase}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  style={{ backgroundColor: active ? "var(--color-accent-primary)" : "var(--color-bg-secondary)", color: "var(--color-text-primary)" }}
                >
                  {active ? <span className="absolute -left-[11px] h-5 w-1 rounded-r-full bg-white" /> : null}
                  {unreadCount > 0 ? (
                    <span className="pointer-events-none absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-paw-accent px-1.5 text-[11px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--color-bg-tertiary)]">
                      {unreadLabel}
                    </span>
                  ) : null}
                  {server.icon_url ? (
                    <img src={server.icon_url} alt={server.name} className="block h-11 w-11 rounded-[14px] object-cover" />
                  ) : (
                    <span className="grid h-11 w-11 place-items-center rounded-[14px] bg-black/20 text-[13px] font-semibold">
                      {server.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </motion.div>
              </Link>
            </Tooltip>
          );
        })}
      </div>
    </aside>
  );
};

