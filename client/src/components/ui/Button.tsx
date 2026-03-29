import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const Button = ({ children, className, ...rest }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
  <button
    className={twMerge(
      clsx(
        "rounded-md border border-transparent bg-paw-accent px-4 py-2 text-sm font-semibold leading-5 text-white transition-colors duration-150 hover:bg-paw-accentSecondary active:bg-paw-accentSecondary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/40 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      ),
    )}
    {...rest}
  >
    {children}
  </button>
);
