import type { PropsWithChildren } from "react";

interface TooltipProps extends PropsWithChildren {
  label: string;
}

export const Tooltip = ({ label, children }: TooltipProps) => (
  <div className="group relative inline-flex">
    {children}
    <span className="pointer-events-none absolute left-1/2 top-full z-40 mt-2 -translate-x-1/2 rounded-md border border-white/10 bg-black/75 px-2 py-1 text-xs text-paw-text-secondary opacity-0 shadow-lg shadow-black/40 backdrop-blur-md transition group-hover:opacity-100">
      {label}
    </span>
  </div>
);
