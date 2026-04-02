export const THEMES = {
  GRAPHITE_GRAY: "graphite-gray",
  OLED_BLACK: "oled-black",
} as const;

export type ThemeId = (typeof THEMES)[keyof typeof THEMES];

export const APP_THEME: ThemeId = THEMES.GRAPHITE_GRAY;

export const isThemeId = (value: string): value is ThemeId =>
  value === THEMES.GRAPHITE_GRAY || value === THEMES.OLED_BLACK;
