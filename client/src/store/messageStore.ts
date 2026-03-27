import { create } from "zustand";
import { produce } from "immer";

import type { Message } from "@/types";

interface MessageReceipt {
  deliveredBy: string[];
  readBy: string[];
  deliveredAt: string | null;
  readAt: string | null;
}

interface MessageState {
  byChannel: Record<string, Message[]>;
  receiptsByMessage: Record<string, MessageReceipt>;
  typingByChannel: Record<string, Record<string, string>>;
  upsertMessage: (channelId: string, message: Message) => void;
  deleteMessage: (channelId: string, messageId: string) => void;
  setMessages: (channelId: string, messages: Message[]) => void;
  markDelivered: (messageId: string, userId: string, at: string) => void;
  markRead: (messageId: string, userId: string, at: string) => void;
  setTyping: (channelId: string, userId: string, expiresAt: string) => void;
  clearTyping: (channelId: string, userId: string) => void;
  pruneTyping: () => void;
}

const sortByCreatedAt = (messages: Message[]): Message[] =>
  [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));

const pickEarlier = (current: string | null, incoming: string | null): string | null => {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }
  return new Date(incoming).getTime() < new Date(current).getTime() ? incoming : current;
};

const ensureReceipt = (state: MessageState, message: Message): MessageReceipt => {
  const existing = state.receiptsByMessage[message.id];
  if (existing) {
    return existing;
  }
  const created: MessageReceipt = {
    deliveredBy: [],
    readBy: [],
    deliveredAt: message.delivered_at ?? null,
    readAt: message.read_at ?? null,
  };
  state.receiptsByMessage[message.id] = created;
  return created;
};

export const useMessageStore = create<MessageState>((set) => ({
  byChannel: {},
  receiptsByMessage: {},
  typingByChannel: {},
  upsertMessage: (channelId, message) =>
    set(
      produce<MessageState>((state) => {
        const current = state.byChannel[channelId] ?? [];
        const existingIndex = current.findIndex((item) => item.id === message.id);
        if (existingIndex >= 0) {
          current[existingIndex] = message;
        } else {
          current.push(message);
        }
        state.byChannel[channelId] = sortByCreatedAt(current);

        const receipt = ensureReceipt(state, message);
        for (const userId of message.delivered_by ?? []) {
          if (!receipt.deliveredBy.includes(userId)) {
            receipt.deliveredBy.push(userId);
          }
        }
        for (const userId of message.read_by ?? []) {
          if (!receipt.readBy.includes(userId)) {
            receipt.readBy.push(userId);
          }
          if (!receipt.deliveredBy.includes(userId)) {
            receipt.deliveredBy.push(userId);
          }
        }
        receipt.deliveredAt = pickEarlier(receipt.deliveredAt, message.delivered_at ?? null);
        receipt.readAt = pickEarlier(receipt.readAt, message.read_at ?? null);
      }),
    ),
  deleteMessage: (channelId, messageId) =>
    set(
      produce<MessageState>((state) => {
        const current = state.byChannel[channelId] ?? [];
        state.byChannel[channelId] = current.filter((item) => item.id !== messageId);
        delete state.receiptsByMessage[messageId];
      }),
    ),
  setMessages: (channelId, messages) =>
    set(
      produce<MessageState>((state) => {
        state.byChannel[channelId] = sortByCreatedAt(messages);
        for (const message of messages) {
          const receipt = ensureReceipt(state, message);
          for (const userId of message.delivered_by ?? []) {
            if (!receipt.deliveredBy.includes(userId)) {
              receipt.deliveredBy.push(userId);
            }
          }
          for (const userId of message.read_by ?? []) {
            if (!receipt.readBy.includes(userId)) {
              receipt.readBy.push(userId);
            }
            if (!receipt.deliveredBy.includes(userId)) {
              receipt.deliveredBy.push(userId);
            }
          }
          receipt.deliveredAt = pickEarlier(receipt.deliveredAt, message.delivered_at ?? null);
          receipt.readAt = pickEarlier(receipt.readAt, message.read_at ?? null);
        }
      }),
    ),
  markDelivered: (messageId, userId, at) =>
    set(
      produce<MessageState>((state) => {
        const receipt = state.receiptsByMessage[messageId] ?? { deliveredBy: [], readBy: [], deliveredAt: null, readAt: null };
        if (!receipt.deliveredBy.includes(userId)) {
          receipt.deliveredBy.push(userId);
        }
        receipt.deliveredAt = pickEarlier(receipt.deliveredAt, at);
        state.receiptsByMessage[messageId] = receipt;
      }),
    ),
  markRead: (messageId, userId, at) =>
    set(
      produce<MessageState>((state) => {
        const receipt = state.receiptsByMessage[messageId] ?? { deliveredBy: [], readBy: [], deliveredAt: null, readAt: null };
        if (!receipt.readBy.includes(userId)) {
          receipt.readBy.push(userId);
        }
        if (!receipt.deliveredBy.includes(userId)) {
          receipt.deliveredBy.push(userId);
        }
        receipt.deliveredAt = pickEarlier(receipt.deliveredAt, at);
        receipt.readAt = pickEarlier(receipt.readAt, at);
        state.receiptsByMessage[messageId] = receipt;
      }),
    ),
  setTyping: (channelId, userId, expiresAt) =>
    set(
      produce<MessageState>((state) => {
        const channelTyping = state.typingByChannel[channelId] ?? {};
        channelTyping[userId] = expiresAt;
        state.typingByChannel[channelId] = channelTyping;
      }),
    ),
  clearTyping: (channelId, userId) =>
    set(
      produce<MessageState>((state) => {
        const channelTyping = state.typingByChannel[channelId];
        if (!channelTyping) {
          return;
        }
        delete channelTyping[userId];
        if (Object.keys(channelTyping).length === 0) {
          delete state.typingByChannel[channelId];
        }
      }),
    ),
  pruneTyping: () =>
    set(
      produce<MessageState>((state) => {
        const now = Date.now();
        for (const [channelId, channelTyping] of Object.entries(state.typingByChannel)) {
          for (const [userId, expiresAt] of Object.entries(channelTyping)) {
            if (new Date(expiresAt).getTime() <= now) {
              delete channelTyping[userId];
            }
          }
          if (Object.keys(channelTyping).length === 0) {
            delete state.typingByChannel[channelId];
          }
        }
      }),
    ),
}));
