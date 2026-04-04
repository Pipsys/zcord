import { clsx } from "clsx";

import { useI18n } from "@/i18n/provider";
import type { Locale } from "@/i18n/messages";

interface LanguageSwitcherProps {
  compact?: boolean;
}

const options: Locale[] = ["ru", "en"];

export const LanguageSwitcher = ({ compact = false }: LanguageSwitcherProps) => {
  const { locale, setLocale, t } = useI18n();

  return (
    <div className="lang-switcher inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#1f2125] p-1">
      {!compact ? <span className="px-2 text-xs text-paw-text-muted">{t("common.language")}</span> : null}
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          className={clsx(
            "lang-switcher-btn rounded px-2.5 py-1 text-[12px] font-semibold leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35",
            locale === option
              ? "lang-switcher-btn--active bg-[#22262e] text-paw-text-primary"
              : "lang-switcher-btn--inactive text-paw-text-muted hover:bg-[#171a20] hover:text-paw-text-secondary",
          )}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
};

