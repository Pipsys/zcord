import { useMemo, type ReactNode } from "react";
import { clsx } from "clsx";
import { useLocation } from "react-router-dom";

import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { useI18n } from "@/i18n/provider";
import { useRealtime } from "@/realtime/RealtimeProvider";
import { useChannelStore } from "@/store/channelStore";
import { useServerStore } from "@/store/serverStore";
import zcordLogo from "../../../animal.png";

interface WindowControlButtonProps {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  className?: string;
}

const WindowControlButton = ({ title, onClick, children, danger = false, className }: WindowControlButtonProps) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={clsx(
      "titlebar-window-btn grid h-7 w-8 place-items-center rounded-md border border-transparent text-paw-text-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35",
      danger ? "hover:bg-[#da373c] hover:text-white active:bg-[#c5353a]" : "hover:bg-white/10 hover:text-paw-text-secondary active:bg-white/15",
      className,
    )}
  >
    {children}
  </button>
);

export const TitleBar = () => {
  const location = useLocation();
  const { t } = useI18n();
  const servers = useServerStore((state) => state.servers);
  const activeServerId = useServerStore((state) => state.activeServerId);
  const channels = useChannelStore((state) => state.channels);
  const activeChannelId = useChannelStore((state) => state.activeChannelId);
  const { voiceRoom, gatewayLatencyMs, gatewayStatus } = useRealtime();
  const connectedVoiceChannel = useMemo(() => {
    if (!voiceRoom.connectedChannelId) {
      return null;
    }
    return channels.find((item) => item.id === voiceRoom.connectedChannelId) ?? null;
  }, [channels, voiceRoom.connectedChannelId]);
  const isMac = useMemo(() => {
    const bridgePlatform = typeof window !== "undefined" && "pawcord" in window ? window.pawcord.system.platform : "";
    if (bridgePlatform) {
      return bridgePlatform === "darwin";
    }
    const fallbackPlatform = typeof navigator !== "undefined" ? navigator.userAgent : "";
    return /mac/i.test(fallbackPlatform);
  }, []);

  const sectionTitle = useMemo(() => {
    if (location.pathname.startsWith("/app/server/")) {
      const routeServerId = location.pathname.replace("/app/server/", "");
      const currentServer = servers.find((item) => item.id === routeServerId) ?? servers.find((item) => item.id === activeServerId) ?? null;
      const currentChannel = channels.find((item) => item.id === activeChannelId) ?? null;
      const serverLabel = currentServer?.name ?? "Server";
      return currentChannel?.name ? `${serverLabel} / #${currentChannel.name}` : serverLabel;
    }
    if (location.pathname.startsWith("/app/settings")) {
      return t("settings.title");
    }
    return t("home.header_friends");
  }, [activeChannelId, activeServerId, channels, location.pathname, servers, t]);

  return (
    <header
      className={clsx(
        "app-titlebar drag-region relative flex items-center justify-between border-b border-black/35",
        "h-[var(--layout-titlebar-height)] bg-paw-bg-secondary px-3",
      )}
    >
      <div className={clsx("min-w-0 flex items-center", isMac ? "gap-3 pl-[76px]" : "gap-2")}>
        <img src={zcordLogo} alt="zcord" className="h-4 w-4 rounded object-contain" />
        <span className={clsx("typo-meta font-semibold uppercase leading-4", isMac ? "tracking-[0.14em]" : "tracking-[0.08em]")}>zcord</span>
        <span className="typo-meta">/</span>
        <span className="typo-title-md truncate">{sectionTitle}</span>
      </div>

      <div className={clsx("no-drag-region flex items-center", isMac ? "gap-2" : "gap-1")}>
        {voiceRoom.connectedChannelId ? (
          <div className="titlebar-voice-chip hidden max-w-[260px] items-center gap-2 rounded-md border border-[#5865f2]/35 bg-[#1b2040] px-2.5 py-1 sm:flex">
            <span className="titlebar-voice-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[#5865f2]" />
            <span className="titlebar-voice-name truncate text-[12px] font-semibold leading-4 text-[#cfd4ff]">{connectedVoiceChannel?.name ? `#${connectedVoiceChannel.name}` : t("voice.connected")}</span>
            <span className="titlebar-voice-latency text-[11px] leading-4 text-paw-text-muted">
              {gatewayStatus === "connected" && gatewayLatencyMs !== null ? `${Math.round(gatewayLatencyMs)}ms` : gatewayStatus}
            </span>
          </div>
        ) : null}

        <LanguageSwitcher compact />

        {!isMac ? (
          <>
            <WindowControlButton title={t("window.minimize")} onClick={() => void window.pawcord.window.minimize()} className="titlebar-window-btn--minimize">
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M3 8.5H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </WindowControlButton>

            <WindowControlButton title={t("window.maximize")} onClick={() => void window.pawcord.window.maximize()} className="titlebar-window-btn--maximize">
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </WindowControlButton>

            <WindowControlButton title={t("window.close")} onClick={() => void window.pawcord.window.close()} danger className="titlebar-window-btn--close">
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </WindowControlButton>
          </>
        ) : null}
      </div>
    </header>
  );
};
