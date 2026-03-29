import { clsx } from "clsx";

interface AvatarProps {
  src?: string | null;
  label: string;
  size?: "sm" | "md" | "lg" | "xl";
  online?: boolean;
}

const sizeClasses = {
  sm: "h-7 w-7 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
  xl: "h-24 w-24 text-xl",
};

export const Avatar = ({ src, label, size = "md", online = false }: AvatarProps) => (
  <div className="relative inline-flex items-center">
    <div
      className={clsx(
        "inline-flex items-center justify-center overflow-hidden rounded-full bg-paw-bg-tertiary text-paw-text-primary",
        sizeClasses[size],
      )}
    >
      {src ? <img src={src} alt={label} className="h-full w-full object-cover" /> : <span>{label.slice(0, 2).toUpperCase()}</span>}
    </div>
    {online ? <span className="absolute bottom-0 right-0 h-2.5 w-2.5 animate-pulseStatus rounded-full bg-[#43b581] ring-2 ring-paw-bg-primary" /> : null}
  </div>
);
