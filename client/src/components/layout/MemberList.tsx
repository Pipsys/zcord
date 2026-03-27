import { useMemo } from "react";

import { useServerMembersQuery } from "@/api/queries";
import { Avatar } from "@/components/ui/Avatar";
import { useI18n } from "@/i18n/provider";
import { useServerStore } from "@/store/serverStore";

interface MemberItem {
  id: string;
  name: string;
  subtitle: string;
  online: boolean;
  avatarUrl?: string | null;
}

export const MemberList = () => {
  const { t } = useI18n();
  const activeServerId = useServerStore((state) => state.activeServerId);
  const { data: serverMembers } = useServerMembersQuery(activeServerId);

  const members = useMemo<MemberItem[]>(() => {
    if (!Array.isArray(serverMembers)) {
      return [];
    }

    return serverMembers.map((member) => {
      const trimmedNickname = member.nickname?.trim();
      const name = trimmedNickname && trimmedNickname.length > 0 ? trimmedNickname : member.username;
      const online = member.status !== "invisible";

      return {
        id: member.user_id,
        name,
        subtitle: online ? t("members.group_online") : t("members.group_offline"),
        online,
        avatarUrl: member.avatar_url,
      };
    });
  }, [serverMembers, t]);

  return (
    <aside className="hidden h-full w-60 border-l border-white/10 bg-black/20 px-2 py-3 backdrop-blur-sm xl:block">
      <h3 className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-paw-text-muted">{t("members.title")}</h3>

      {members.length === 0 ? <p className="px-2 text-xs text-paw-text-muted">{t("members.none")}</p> : null}

      <div className="space-y-1">
        {members.map((member) => (
          <div key={member.id} className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 hover:border-white/10 hover:bg-paw-bg-elevated/60">
            <Avatar src={member.avatarUrl} label={member.name} online={member.online} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm text-paw-text-secondary">{member.name}</p>
              <p className="truncate text-[11px] text-paw-text-muted">{member.subtitle}</p>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};
