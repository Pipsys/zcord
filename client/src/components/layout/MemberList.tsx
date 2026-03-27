import { useMemo } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { useI18n } from "@/i18n/provider";
import { useAuthStore } from "@/store/authStore";
import { useChannelStore } from "@/store/channelStore";
import { useMessageStore } from "@/store/messageStore";

interface MemberItem {
  id: string;
  name: string;
  online: boolean;
  avatarUrl?: string | null;
}

const buildLabel = (id: string): string => `user-${id.slice(0, 6)}`;

export const MemberList = () => {
  const { t } = useI18n();
  const user = useAuthStore((state) => state.user);
  const activeChannelId = useChannelStore((state) => state.activeChannelId);
  const messagesByChannel = useMessageStore((state) => state.byChannel);

  const members = useMemo<MemberItem[]>(() => {
    const list: MemberItem[] = [];
    const seen = new Set<string>();

    if (user?.id) {
      list.push({ id: user.id, name: user.username, online: true, avatarUrl: user.avatar_url });
      seen.add(user.id);
    }

    const channelMessages = activeChannelId ? messagesByChannel[activeChannelId] ?? [] : [];
    for (const message of channelMessages) {
      if (!seen.has(message.author_id)) {
        const authorName = message.author_username?.trim() || buildLabel(message.author_id);
        list.push({ id: message.author_id, name: authorName, online: true, avatarUrl: message.author_avatar_url ?? null });
        seen.add(message.author_id);
      }
    }

    return list;
  }, [activeChannelId, messagesByChannel, user?.id, user?.username]);

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
              <p className="truncate text-[11px] text-paw-text-muted">{member.id.slice(0, 8)}</p>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};
