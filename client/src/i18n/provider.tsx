import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { dictionaries, type Locale, type TranslationKey, type TranslationParams } from "@/i18n/messages";

const STORAGE_KEY = "pawcord.locale";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const detectInitialLocale = (): Locale => {
  const fallback: Locale = "ru";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ru" || stored === "en") {
      return stored;
    }
  } catch {
    return fallback;
  }
  return fallback;
};

const formatMessage = (template: string, params?: TranslationParams): string => {
  if (!params) {
    return template;
  }
  return Object.entries(params).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), template);
};

export const I18nProvider = ({ children }: PropsWithChildren) => {
  const [locale, setLocale] = useState<Locale>(detectInitialLocale);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Ignore storage persistence errors in restricted environments.
    }
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => formatMessage(dictionaries[locale][key], params),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
};
