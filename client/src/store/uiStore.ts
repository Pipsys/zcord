import { create } from "zustand";
import { produce } from "immer";

import { APP_THEME, isThemeId, type ThemeId } from "@/theme/themes";

interface Toast {
  id: string;
  title: string;
  description: string;
}

const MAX_TOASTS_VISIBLE = 3;
const THEME_STORAGE_KEY = "pawcord.theme";

const applyTheme = (theme: ThemeId): void => {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.setAttribute("data-theme", theme);
};

const persistTheme = (theme: ThemeId): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore persistence errors in restricted environments.
  }
};

const resolveStoredTheme = (): ThemeId => {
  if (typeof window === "undefined") {
    return APP_THEME;
  }
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (value && isThemeId(value)) {
      return value;
    }
  } catch {
    // Ignore storage read errors and fall back to default theme.
  }
  return APP_THEME;
};

interface UiState {
  isSidebarCollapsed: boolean;
  toasts: Toast[];
  theme: ThemeId;
  setSidebarCollapsed: (collapsed: boolean) => void;
  pushToast: (title: string, description: string) => void;
  removeToast: (id: string) => void;
  hydrateTheme: () => void;
  setTheme: (theme: ThemeId) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isSidebarCollapsed: false,
  toasts: [],
  theme: APP_THEME,
  setSidebarCollapsed: (collapsed) =>
    set(
      produce<UiState>((state) => {
        state.isSidebarCollapsed = collapsed;
      }),
    ),
  pushToast: (title, description) => {
    let shouldNotify = false;
    set(
      produce<UiState>((state) => {
        const duplicateVisible = state.toasts.some((toast) => toast.title === title && toast.description === description);
        if (duplicateVisible) {
          return;
        }
        shouldNotify = true;
        state.toasts.push({ id: crypto.randomUUID(), title, description });
        if (state.toasts.length > MAX_TOASTS_VISIBLE) {
          state.toasts = state.toasts.slice(-MAX_TOASTS_VISIBLE);
        }
      }),
    );
    if (shouldNotify) {
      void window.pawcord.notify(title, description);
    }
  },
  removeToast: (id) =>
    set(
      produce<UiState>((state) => {
        state.toasts = state.toasts.filter((toast) => toast.id !== id);
      }),
    ),
  hydrateTheme: () => {
    const theme = resolveStoredTheme();
    applyTheme(theme);
    set(
      produce<UiState>((state) => {
        state.theme = theme;
      }),
    );
  },
  setTheme: (theme) => {
    applyTheme(theme);
    persistTheme(theme);
    set(
      produce<UiState>((state) => {
        state.theme = theme;
      }),
    );
  },
}));
