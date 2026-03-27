import { create } from "zustand";
import { produce } from "immer";

import type { Server } from "@/types";

interface ServerState {
  servers: Server[];
  activeServerId: string | null;
  setServers: (servers: Server[]) => void;
  setActiveServer: (serverId: string | null) => void;
}

export const useServerStore = create<ServerState>((set) => ({
  servers: [],
  activeServerId: null,
  setServers: (servers) =>
    set(
      produce<ServerState>((state) => {
        state.servers = servers;
      }),
    ),
  setActiveServer: (serverId) =>
    set(
      produce<ServerState>((state) => {
        state.activeServerId = serverId;
      }),
    ),
}));
