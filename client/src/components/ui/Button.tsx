import type { ButtonHTMLAttributes, PropsWithChildren } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = ({
  children,
  className,
  variant = "primary",
  size = "md",
  ...rest
}: PropsWithChildren<ButtonProps>) => (
  <button
    className={twMerge(
      clsx(
        "ui-btn focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/40",
        {
          "ui-btn-sm": size === "sm",
          "ui-btn-md": size === "md",
          "ui-btn-lg": size === "lg",
          "ui-btn-primary": variant === "primary",
          "ui-btn-secondary": variant === "secondary",
          "ui-btn-ghost": variant === "ghost",
          "ui-btn-danger": variant === "danger",
        },
        className,
      ),
    )}
    {...rest}
  >
    {children}
  </button>
);
