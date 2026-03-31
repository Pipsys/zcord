import { useMemo } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";

import { Tooltip } from "@/components/ui/Tooltip";
import { useI18n } from "@/i18n/provider";
import { useServerStore } from "@/store/serverStore";
import type { VoiceParticipant } from "@/store/voiceStore";
import { useVoiceStore } from "@/store/voiceStore";
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

export const Sidebar = () => {
  const { t } = useI18n();
  const location = useLocation();
  const routeServerId = location.pathname.startsWith("/app/server/") ? location.pathname.replace("/app/server/", "") : null;

  const servers = useServerStore((state) => state.servers);
  const activeServerId = useServerStore((state) => state.activeServerId);
  const setActiveServer = useServerStore((state) => state.setActiveServer);
  const participantsByChannel = useVoiceStore((state) => state.participantsByChannel);

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
          </motion.div>
        </Link>
      </Tooltip>

      <div className="h-px w-8 bg-white/8" />

      <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto pb-2">
        {servers.map((server) => {
          const active = server.id === activeServerId || server.id === routeServerId;
          const serverVoiceMembers = voiceMembersByServer[server.id] ?? [];
          const previewVoiceMembers = serverVoiceMembers.slice(0, 4);
          const hiddenVoiceMembersCount = Math.max(0, serverVoiceMembers.length - previewVoiceMembers.length);
          const tooltipContent = (
              <div className="w-[150px]">
                <div className="typo-meta truncate font-semibold text-paw-text-primary">{server.name}</div>
                {serverVoiceMembers.length > 0 ? (
                <>
                  <div className="mt-1.5 flex items-center gap-2">
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

