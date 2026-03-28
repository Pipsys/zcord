import { useMemo, type ReactNode } from "react";
import { clsx } from "clsx";
import { useLocation } from "react-router-dom";

import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { useI18n } from "@/i18n/provider";
import rucordLogo from "../../../animal.png";

interface WindowControlButtonProps {
  title: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}

const WindowControlButton = ({ title, onClick, children, danger = false }: WindowControlButtonProps) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={clsx(
      "grid h-7 w-8 place-items-center rounded-md border border-transparent text-paw-text-muted transition-colors",
      danger ? "hover:bg-[#da373c] hover:text-white" : "hover:bg-white/10 hover:text-paw-text-secondary",
    )}
  >
    {children}
  </button>
);

export const TitleBar = () => {
  const location = useLocation();
  const { t } = useI18n();
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
      return "Server";
    }
    if (location.pathname.startsWith("/app/settings")) {
      return t("settings.title");
    }
    return t("home.header_friends");
  }, [location.pathname, t]);

  return (
    <header
      className={clsx(
        "drag-region relative flex items-center justify-between border-b border-white/10",
        isMac ? "h-12 bg-[#12171dcc]/90 px-4 backdrop-blur-xl" : "h-10 bg-black/20 px-3",
      )}
    >
      {isMac ? <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" /> : null}

      <div className={clsx("min-w-0 flex items-center", isMac ? "gap-3 pl-[76px]" : "gap-2")}>
        <img src={rucordLogo} alt="Rucord" className="h-4 w-4 rounded object-contain" />
        <span className={clsx("font-semibold uppercase text-paw-text-muted", isMac ? "text-[11px] tracking-[0.18em]" : "text-xs tracking-[0.08em]")}>Rucord</span>
        <span className="text-xs text-paw-text-muted">/</span>
        <span className={clsx("truncate font-semibold text-paw-text-secondary", isMac ? "text-[13px]" : "text-sm")}>{sectionTitle}</span>
      </div>

      <div className={clsx("no-drag-region flex items-center", isMac ? "gap-2" : "gap-1")}>
        <LanguageSwitcher compact />

        {!isMac ? (
          <>
            <WindowControlButton title={t("window.minimize")} onClick={() => void window.pawcord.window.minimize()}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M3 8.5H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </WindowControlButton>

            <WindowControlButton title={t("window.maximize")} onClick={() => void window.pawcord.window.maximize()}>
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </WindowControlButton>

            <WindowControlButton title={t("window.close")} onClick={() => void window.pawcord.window.close()} danger>
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
