import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const Button = ({ children, className, ...rest }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
  <button
    className={twMerge(
      clsx(
        "rounded-md border border-white/10 bg-paw-accent px-4 py-2 text-sm font-semibold text-white shadow-[0_6px_18px_var(--color-accent-glow)] transition-colors hover:bg-paw-accentSecondary active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      ),
    )}
    {...rest}
  >
    {children}
  </button>
);
