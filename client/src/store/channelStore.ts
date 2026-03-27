import { create } from "zustand";
import { produce } from "immer";

import type { Channel } from "@/types";

interface ChannelState {
  channels: Channel[];
  activeChannelId: string | null;
  setChannels: (channels: Channel[]) => void;
  setActiveChannel: (channelId: string | null) => void;
}

export const useChannelStore = create<ChannelState>((set) => ({
  channels: [],
  activeChannelId: null,
  setChannels: (channels) =>
    set(
      produce<ChannelState>((state) => {
        state.channels = channels;
      }),
    ),
  setActiveChannel: (channelId) =>
    set(
      produce<ChannelState>((state) => {
        state.activeChannelId = channelId;
      }),
    ),
}));
