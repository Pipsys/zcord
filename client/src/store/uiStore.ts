import { create } from "zustand";
import { produce } from "immer";

import { APP_THEME, type ThemeId } from "@/theme/themes";

interface Toast {
  id: string;
  title: string;
  description: string;
}

const applyTheme = (): void => {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.setAttribute("data-theme", APP_THEME);
};

interface UiState {
  isSidebarCollapsed: boolean;
  toasts: Toast[];
  theme: ThemeId;
  setSidebarCollapsed: (collapsed: boolean) => void;
  pushToast: (title: string, description: string) => void;
  removeToast: (id: string) => void;
  hydrateTheme: () => void;
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
    void window.pawcord.notify(title, description);
    set(
      produce<UiState>((state) => {
        state.toasts.push({ id: crypto.randomUUID(), title, description });
      }),
    );
  },
  removeToast: (id) =>
    set(
      produce<UiState>((state) => {
        state.toasts = state.toasts.filter((toast) => toast.id !== id);
      }),
    ),
  hydrateTheme: () => {
    applyTheme();
    set(
      produce<UiState>((state) => {
        state.theme = APP_THEME;
      }),
    );
  },
}));
