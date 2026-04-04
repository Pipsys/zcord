import { create } from "zustand";
import { produce } from "immer";

import type { Server } from "@/types";

const SERVER_ORDER_STORAGE_KEY = "pawcord.server-order";

const readStoredServerOrder = (): string[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(SERVER_ORDER_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
};

const persistServerOrder = (order: string[]): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(SERVER_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Ignore storage errors in restricted environments.
  }
};

const orderServers = (incoming: Server[], preferredOrder: string[]): Server[] => {
  const indexById = new Map<string, number>(preferredOrder.map((id, index) => [id, index]));
  return [...incoming].sort((left, right) => {
    const leftIndex = indexById.get(left.id);
    const rightIndex = indexById.get(right.id);
    if (typeof leftIndex === "number" && typeof rightIndex === "number") {
      return leftIndex - rightIndex;
    }
    if (typeof leftIndex === "number") {
      return -1;
    }
    if (typeof rightIndex === "number") {
      return 1;
    }
    return 0;
  });
};

interface ServerState {
  servers: Server[];
  serverOrder: string[];
  activeServerId: string | null;
  setServers: (servers: Server[]) => void;
  setActiveServer: (serverId: string | null) => void;
  setServerOrder: (order: string[]) => void;
  moveServer: (serverId: string, toIndex: number) => void;
}

export const useServerStore = create<ServerState>((set) => ({
  servers: [],
  serverOrder: readStoredServerOrder(),
  activeServerId: null,
  setServers: (servers) =>
    set(
      produce<ServerState>((state) => {
        const nextServers = orderServers(servers, state.serverOrder);
        state.servers = nextServers;
        state.serverOrder = nextServers.map((server) => server.id);
        persistServerOrder(state.serverOrder);
      }),
    ),
  setActiveServer: (serverId) =>
    set(
      produce<ServerState>((state) => {
        state.activeServerId = serverId;
      }),
    ),
  setServerOrder: (order) =>
    set(
      produce<ServerState>((state) => {
        const deduped = Array.from(new Set(order));
        state.serverOrder = deduped;
        state.servers = orderServers(state.servers, deduped);
        persistServerOrder(state.serverOrder);
      }),
    ),
  moveServer: (serverId, toIndex) =>
    set(
      produce<ServerState>((state) => {
        const currentIndex = state.servers.findIndex((server) => server.id === serverId);
        if (currentIndex < 0) {
          return;
        }
        const maxIndex = state.servers.length - 1;
        const nextIndex = Math.max(0, Math.min(maxIndex, toIndex));
        if (nextIndex === currentIndex) {
          return;
        }
        const [moved] = state.servers.splice(currentIndex, 1);
        state.servers.splice(nextIndex, 0, moved);
        state.serverOrder = state.servers.map((server) => server.id);
        persistServerOrder(state.serverOrder);
      }),
    ),
}));
