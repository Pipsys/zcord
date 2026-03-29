import { create } from "zustand";
import { produce } from "immer";

export interface VoiceParticipant {
  user_id: string;
  channel_id: string;
  server_id: string | null;
  username?: string | null;
  avatar_url?: string | null;
  muted: boolean;
  deafened: boolean;
  screen_sharing?: boolean;
}

export interface VoiceSignalEvent {
  channel_id: string;
  server_id: string | null;
  user_id: string;
  target_user_id: string | null;
  signal_type: "offer" | "answer" | "ice-candidate";
  payload: Record<string, unknown>;
}

interface VoiceState {
  connectedChannelId: string | null;
  participantsByChannel: Record<string, VoiceParticipant[]>;
  signalsByChannel: Record<string, VoiceSignalEvent[]>;
  setConnectedChannel: (channelId: string | null) => void;
  setParticipantsSnapshot: (channelId: string, participants: VoiceParticipant[]) => void;
  upsertParticipant: (channelId: string, participant: VoiceParticipant) => void;
  removeParticipant: (channelId: string, userId: string) => void;
  updateParticipantState: (
    channelId: string,
    userId: string,
    muted: boolean,
    deafened: boolean,
    screenSharing?: boolean,
    username?: string | null,
    avatarUrl?: string | null,
  ) => void;
  enqueueSignal: (event: VoiceSignalEvent) => void;
  consumeSignals: (channelId: string) => VoiceSignalEvent[];
  clearChannel: (channelId: string) => void;
  reset: () => void;
}

const uniqueParticipants = (participants: VoiceParticipant[]): VoiceParticipant[] => {
  const map = new Map<string, VoiceParticipant>();
  for (const participant of participants) {
    map.set(participant.user_id, participant);
  }
  return Array.from(map.values());
};

export const useVoiceStore = create<VoiceState>((set, get) => ({
  connectedChannelId: null,
  participantsByChannel: {},
  signalsByChannel: {},
  setConnectedChannel: (channelId) =>
    set(
      produce<VoiceState>((state) => {
        state.connectedChannelId = channelId;
      }),
    ),
  setParticipantsSnapshot: (channelId, participants) =>
    set(
      produce<VoiceState>((state) => {
        state.participantsByChannel[channelId] = uniqueParticipants(participants);
      }),
    ),
  upsertParticipant: (channelId, participant) =>
    set(
      produce<VoiceState>((state) => {
        const current = state.participantsByChannel[channelId] ?? [];
        const next = current.filter((item) => item.user_id !== participant.user_id);
        next.push(participant);
        state.participantsByChannel[channelId] = next;
      }),
    ),
  removeParticipant: (channelId, userId) =>
    set(
      produce<VoiceState>((state) => {
        const current = state.participantsByChannel[channelId] ?? [];
        const next = current.filter((item) => item.user_id !== userId);
        if (next.length > 0) {
          state.participantsByChannel[channelId] = next;
        } else {
          delete state.participantsByChannel[channelId];
        }
      }),
    ),
  updateParticipantState: (channelId, userId, muted, deafened, screenSharing, username, avatarUrl) =>
    set(
      produce<VoiceState>((state) => {
        const current = state.participantsByChannel[channelId] ?? [];
        const existing = current.find((item) => item.user_id === userId);
        if (!existing) {
          const next = current.slice();
          next.push({
            user_id: userId,
            channel_id: channelId,
            server_id: null,
            username: typeof username === "string" ? username : null,
            avatar_url: typeof avatarUrl === "string" ? avatarUrl : null,
            muted,
            deafened,
            screen_sharing: typeof screenSharing === "boolean" ? screenSharing : false,
          });
          state.participantsByChannel[channelId] = next;
          return;
        }
        existing.muted = muted;
        existing.deafened = deafened;
        if (typeof screenSharing === "boolean") {
          existing.screen_sharing = screenSharing;
        }
        if (typeof username === "string" || username === null) {
          existing.username = username;
        }
        if (typeof avatarUrl === "string" || avatarUrl === null) {
          existing.avatar_url = avatarUrl;
        }
      }),
    ),
  enqueueSignal: (event) =>
    set(
      produce<VoiceState>((state) => {
        const queue = state.signalsByChannel[event.channel_id] ?? [];
        queue.push(event);
        state.signalsByChannel[event.channel_id] = queue;
      }),
    ),
  consumeSignals: (channelId) => {
    const queued = get().signalsByChannel[channelId] ?? [];
    if (queued.length === 0) {
      return [];
    }
    set(
      produce<VoiceState>((state) => {
        delete state.signalsByChannel[channelId];
      }),
    );
    return queued;
  },
  clearChannel: (channelId) =>
    set(
      produce<VoiceState>((state) => {
        delete state.participantsByChannel[channelId];
        delete state.signalsByChannel[channelId];
        if (state.connectedChannelId === channelId) {
          state.connectedChannelId = null;
        }
      }),
    ),
  reset: () =>
    set(
      produce<VoiceState>((state) => {
        state.connectedChannelId = null;
        state.participantsByChannel = {};
        state.signalsByChannel = {};
      }),
    ),
}));
