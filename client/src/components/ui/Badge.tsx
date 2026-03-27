interface BadgeProps {
  value: string | number;
  tone?: "accent" | "danger" | "neutral";
}

const toneClasses = {
  accent: "bg-paw-accent text-black",
  danger: "bg-[#f04747] text-white",
  neutral: "bg-paw-bg-elevated text-paw-text-secondary",
};

export const Badge = ({ value, tone = "accent" }: BadgeProps) => (
  <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold ${toneClasses[tone]}`}>
    {value}
  </span>
);
