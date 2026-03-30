import { useEffect, useMemo, useState } from "react";
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

const stableSignedAvatarUrlCache = new Map<string, string>();

const getStableAvatarUrl = (rawSrc?: string | null): string | null => {
  if (!rawSrc) {
    return null;
  }

  if (typeof window === "undefined") {
    return rawSrc;
  }

  try {
    const parsed = new URL(rawSrc, window.location.href);
    const cacheKey = `${parsed.origin}${parsed.pathname}`;
    const cached = stableSignedAvatarUrlCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const next = parsed.toString();
    stableSignedAvatarUrlCache.set(cacheKey, next);
    return next;
  } catch {
    return rawSrc;
  }
};

export const Avatar = ({ src, label, size = "md", online = false }: AvatarProps) => {
  const initials = useMemo(() => label.slice(0, 2).toUpperCase(), [label]);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() => getStableAvatarUrl(src));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setResolvedSrc(getStableAvatarUrl(src));
    setLoaded(false);
  }, [src]);

  return (
    <div className="relative inline-flex items-center">
      <div
        className={clsx(
          "relative inline-flex items-center justify-center overflow-hidden rounded-full bg-paw-bg-tertiary text-paw-text-primary",
          sizeClasses[size],
        )}
      >
        <span className="select-none font-semibold">{initials}</span>
        {resolvedSrc ? (
          <img
            src={resolvedSrc}
            alt={label}
            loading={size === "xl" ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={size === "xl" ? "high" : "auto"}
            onLoad={() => setLoaded(true)}
            onError={() => {
              setResolvedSrc(null);
              setLoaded(false);
            }}
            className={clsx(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-150",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        ) : null}
      </div>
      {online ? <span className="absolute bottom-0 right-0 h-2.5 w-2.5 animate-pulseStatus rounded-full bg-[#43b581] ring-2 ring-paw-bg-primary" /> : null}
    </div>
  );
};
