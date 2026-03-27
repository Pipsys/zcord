import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paw: {
          bgPrimary: "var(--color-bg-primary)",
          bgSecondary: "var(--color-bg-secondary)",
          bgTertiary: "var(--color-bg-tertiary)",
          elevated: "var(--color-bg-elevated)",
          accent: "var(--color-accent-primary)",
          accentSecondary: "var(--color-accent-secondary)",
          textPrimary: "var(--color-text-primary)",
          textSecondary: "var(--color-text-secondary)",
          textMuted: "var(--color-text-muted)",
        },
      },
      fontFamily: {
        display: ["Sora", "sans-serif"],
        body: ["DM Sans", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        glow: "0 0 24px var(--color-accent-glow)",
      },
      keyframes: {
        pulseStatus: {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.08)", opacity: "0.7" },
        },
      },
      animation: {
        pulseStatus: "pulseStatus 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
