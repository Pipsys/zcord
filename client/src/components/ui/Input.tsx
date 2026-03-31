import type { InputHTMLAttributes } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = ({ className, ...rest }: InputProps) => (
  <input
    className={twMerge(
      clsx("ui-input", className),
    )}
    {...rest}
  />
);
