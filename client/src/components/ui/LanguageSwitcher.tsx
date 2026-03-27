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
    <div className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/25 p-1 backdrop-blur-md">
      {!compact ? <span className="px-2 text-xs text-paw-text-muted">{t("common.language")}</span> : null}
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          className={clsx(
            "rounded px-2 py-1 text-xs font-medium transition",
            locale === option ? "bg-paw-bg-elevated text-paw-text-primary" : "text-paw-text-muted hover:bg-white/5 hover:text-paw-text-secondary",
          )}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </div>
  );
};
