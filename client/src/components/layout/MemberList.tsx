import { useMemo } from "react";

import { useServerMembersQuery } from "@/api/queries";
import { Avatar } from "@/components/ui/Avatar";
import { useI18n } from "@/i18n/provider";
import { useServerStore } from "@/store/serverStore";
import { useVoiceStore } from "@/store/voiceStore";

interface MemberItem {
  id: string;
  name: string;
  subtitle: string;
  online: boolean;
  avatarUrl?: string | null;
  inVoice: boolean;
  screenSharing: boolean;
}

export const MemberList = () => {
  const { t } = useI18n();
  const activeServerId = useServerStore((state) => state.activeServerId);
  const { data: serverMembers } = useServerMembersQuery(activeServerId);
  const participantsByChannel = useVoiceStore((state) => state.participantsByChannel);

  const voiceStateByUserId = useMemo(() => {
    if (!activeServerId) {
      return new Map<string, { inVoice: boolean; screenSharing: boolean }>();
    }

    const next = new Map<string, { inVoice: boolean; screenSharing: boolean }>();
    for (const participants of Object.values(participantsByChannel)) {
      for (const participant of participants) {
        if (participant.server_id !== activeServerId) {
          continue;
        }
        const current = next.get(participant.user_id) ?? { inVoice: false, screenSharing: false };
        next.set(participant.user_id, {
          inVoice: true,
          screenSharing: current.screenSharing || participant.screen_sharing,
        });
      }
    }
    return next;
  }, [activeServerId, participantsByChannel]);

  const members = useMemo<MemberItem[]>(() => {
    if (!Array.isArray(serverMembers)) {
      return [];
    }

    return serverMembers.map((member) => {
      const trimmedNickname = member.nickname?.trim();
      const name = trimmedNickname && trimmedNickname.length > 0 ? trimmedNickname : member.username;
      const online = Boolean(member.is_online);
      const recentlyOnline = Boolean(member.was_recently_online);
      const subtitle = online ? t("members.group_online") : recentlyOnline ? t("members.group_recently") : t("members.group_offline");
      const voiceState = voiceStateByUserId.get(member.user_id) ?? { inVoice: false, screenSharing: false };

      return {
        id: member.user_id,
        name,
        subtitle,
        online,
        avatarUrl: member.avatar_url,
        inVoice: voiceState.inVoice,
        screenSharing: voiceState.screenSharing,
      };
    });
  }, [serverMembers, t, voiceStateByUserId]);

  return (
    <aside className="member-list-panel hidden h-full w-[var(--layout-member-list-width)] border-l border-black/35 bg-paw-bg-secondary px-2 py-3 xl:block">
      <h3 className="typo-meta mb-3 px-2 font-semibold uppercase tracking-[0.04em]">{t("members.title")}</h3>

      {members.length === 0 ? <p className="px-2 text-xs text-paw-text-muted">{t("members.none")}</p> : null}

      <div className="space-y-1">
        {members.map((member) => {
          const rowStateClass = member.screenSharing ? "ui-state-mention" : member.inVoice ? "ui-state-unread" : "";
          return (
            <div
              key={member.id}
              className={`member-list-row relative flex h-9 items-center gap-2 rounded-md border border-transparent px-2 transition-colors hover:border-white/10 hover:bg-[#1f2229] ${rowStateClass}`}
            >
              {member.screenSharing ? <span className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-[#f0b232]" /> : null}
              {!member.screenSharing && member.inVoice ? <span className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-[#7b85ff]" /> : null}
              <Avatar src={member.avatarUrl} label={member.name} online={member.online} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="typo-body truncate text-paw-text-secondary">{member.name}</p>
                <p className="typo-meta truncate">{member.subtitle}</p>
              </div>
              {member.screenSharing ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f0b232] px-1.5 text-[11px] font-bold leading-none text-[#1a1f22]">
                  @
                </span>
              ) : member.inVoice ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#3b82f6] px-1.5 text-[11px] font-bold leading-none text-white">
                  V
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
};

