import { create } from "zustand";
import { produce } from "immer";

import { queryClient } from "@/api/queryClient";
import { useChannelStore } from "@/store/channelStore";
import { useMessageStore } from "@/store/messageStore";
import { useServerStore } from "@/store/serverStore";
import { useUiStore } from "@/store/uiStore";
import type { User } from "@/types";

interface AuthState {
  token: string | null;
  user: User | null;
  hydrated: boolean;
  setAuth: (token: string, user: User) => Promise<void>;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  clearAuth: () => Promise<void>;
  hydrate: () => Promise<void>;
}

const syncMeCache = (user: User | null) => {
  if (user) {
    queryClient.setQueryData(["me"], user);
    return;
  }
  queryClient.removeQueries({ queryKey: ["me"], exact: true });
};

const fetchCurrentUser = async (): Promise<User | null> => {
  try {
    const response = await window.pawcord.request<User>({ method: "GET", path: "/users/me" });
    return response.ok ? response.data : null;
  } catch {
    return null;
  }
};

const resetClientSession = (
  set: (
    partial: AuthState | Partial<AuthState> | ((state: AuthState) => AuthState | Partial<AuthState>),
    replace?: false,
  ) => void,
) => {
  syncMeCache(null);
  queryClient.clear();
  useServerStore.setState({ servers: [], activeServerId: null });
  useChannelStore.setState({ channels: [], activeChannelId: null });
  useMessageStore.setState({ byChannel: {}, receiptsByMessage: {}, typingByChannel: {} });
  useUiStore.setState({ toasts: [] });

  set(
    produce<AuthState>((state) => {
      state.token = null;
      state.user = null;
    }),
  );
};

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  hydrated: false,
  setAuth: async (token, user) => {
    await window.pawcord.auth.setToken(token);
    let nextUser = user;
    const fullUser = await fetchCurrentUser();
    if (fullUser) {
      nextUser = fullUser;
    }
    syncMeCache(nextUser);
    set(
      produce<AuthState>((state) => {
        state.token = token;
        state.user = nextUser;
      }),
    );
  },
  setUser: (user) => {
    syncMeCache(user);
    set(
      produce<AuthState>((state) => {
        state.user = user;
      }),
    );
  },
  setToken: (token) => {
    set(
      produce<AuthState>((state) => {
        state.token = token;
      }),
    );
  },
  clearAuth: async () => {
    const logoutPromise = window.pawcord.auth.logout().catch(() => window.pawcord.auth.clearToken());
    await queryClient.cancelQueries();
    resetClientSession(set);
    await logoutPromise;
  },
  hydrate: async () => {
    let token = await window.pawcord.auth.getToken();
    let user: User | null = null;

    if (token) {
      try {
        const response = await window.pawcord.request<User>({ method: "GET", path: "/users/me" });
        if (response.ok) {
          user = response.data;
          token = await window.pawcord.auth.getToken();
          syncMeCache(user);
        } else {
          token = null;
          syncMeCache(null);
          await window.pawcord.auth.clearToken();
        }
      } catch {
        user = null;
        token = null;
        syncMeCache(null);
        await window.pawcord.auth.clearToken();
      }
    } else {
      syncMeCache(null);
    }

    set(
      produce<AuthState>((state) => {
        state.token = token;
        state.user = user;
        state.hydrated = true;
      }),
    );
  },
}));
