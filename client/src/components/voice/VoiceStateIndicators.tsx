import { clsx } from "clsx";

interface VoiceStateIndicatorsProps {
  muted: boolean;
  deafened: boolean;
  className?: string;
}

interface VoiceAvatarStateBadgeProps {
  muted: boolean;
  deafened: boolean;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

const MicOffIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={clsx("fill-none stroke-current stroke-[1.9]", className)} aria-hidden>
    <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z" />
    <path d="M19 11a7 7 0 0 1-12 4.95" />
    <path d="M5 11a7 7 0 0 0 10.64 5.95" />
    <path d="M12 19v3" />
    <path d="M9 22h6" />
    <path d="M4 4l16 16" />
  </svg>
);

const HeadphonesOffIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={clsx("fill-none stroke-current stroke-[1.9]", className)} aria-hidden>
    <path d="M4 14h4l5 4V6L8 10H4z" />
    <path d="M4 4l16 16" />
  </svg>
);

const VoiceStateIcon = ({ type, className }: { type: "muted" | "deafened"; className?: string }) => (
  <span className={clsx("inline-grid place-items-center text-[#b5bac1]/95", className)}>
    {type === "deafened" ? <HeadphonesOffIcon className="h-full w-full" /> : <MicOffIcon className="h-full w-full" />}
  </span>
);

export const VoiceStateIndicators = ({ muted, deafened, className }: VoiceStateIndicatorsProps) => {
  if (!muted && !deafened) {
    return null;
  }

  return (
    <span className={clsx("inline-flex items-center gap-1 text-[#b5bac1]/90", className)}>
      {muted ? <VoiceStateIcon type="muted" className="h-[18px] w-[18px]" /> : null}
      {deafened ? <VoiceStateIcon type="deafened" className="h-[18px] w-[18px]" /> : null}
    </span>
  );
};

const avatarBadgeStyles = {
  sm: {
    root: "-bottom-0.5 -right-0.5 gap-[2px]",
    item: "h-[18px] w-[18px]",
    icon: "h-2.5 w-2.5",
  },
  md: {
    root: "-bottom-1 -right-1 gap-[2px]",
    item: "h-5 w-5",
    icon: "h-3 w-3",
  },
  lg: {
    root: "-bottom-1 -right-1 gap-[3px]",
    item: "h-[22px] w-[22px]",
    icon: "h-[13px] w-[13px]",
  },
  xl: {
    root: "-bottom-2 -right-2 gap-[4px]",
    item: "h-6 w-6",
    icon: "h-4 w-4",
  },
} as const;

export const VoiceAvatarStateBadge = ({ muted, deafened, className, size = "md" }: VoiceAvatarStateBadgeProps) => {
  if (!muted && !deafened) {
    return null;
  }

  const preset = avatarBadgeStyles[size];
  const states: Array<"muted" | "deafened"> = [];
  if (muted) {
    states.push("muted");
  }
  if (deafened) {
    states.push("deafened");
  }

  return (
    <span className={clsx("pointer-events-none absolute inline-flex items-center", preset.root, className)}>
      {states.map((state) => (
        <span
          key={state}
          className={clsx(
            "grid place-items-center rounded-full border border-black/60 bg-[#111318]/95 text-[#b5bac1] shadow-[0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-[#2b2d31]",
            preset.item,
          )}
        >
          <VoiceStateIcon type={state} className={preset.icon} />
        </span>
      ))}
    </span>
  );
};
