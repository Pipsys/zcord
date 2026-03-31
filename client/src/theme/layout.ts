export const LAYOUT_SIDEBAR_WIDTH = 72;
export const LAYOUT_MEMBER_LIST_WIDTH = 240;
export const LAYOUT_CHANNEL_LIST_MIN_WIDTH = 220;
export const LAYOUT_CHANNEL_LIST_MAX_WIDTH = 360;
export const LAYOUT_CHANNEL_LIST_DEFAULT_WIDTH = 240;

export const CHANNEL_LIST_WIDTH_STORAGE_KEY = "zcord.channel-list-width";

export const clampChannelListWidth = (value: number): number =>
  Math.min(LAYOUT_CHANNEL_LIST_MAX_WIDTH, Math.max(LAYOUT_CHANNEL_LIST_MIN_WIDTH, value));

export const readStoredChannelListWidth = (): number => {
  if (typeof window === "undefined") {
    return LAYOUT_CHANNEL_LIST_DEFAULT_WIDTH;
  }
  const raw = window.localStorage.getItem(CHANNEL_LIST_WIDTH_STORAGE_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return LAYOUT_CHANNEL_LIST_DEFAULT_WIDTH;
  }
  return clampChannelListWidth(parsed);
};
