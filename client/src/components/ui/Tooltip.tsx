import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { createPortal } from "react-dom";

interface TooltipProps extends PropsWithChildren {
  label: string;
  side?: "bottom" | "right";
}

export const Tooltip = ({ label, side = "bottom", children }: TooltipProps) => {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  const updatePosition = () => {
    const node = anchorRef.current;
    if (!node) {
      return;
    }
    const rect = node.getBoundingClientRect();
    if (side === "right") {
      setPosition({
        left: rect.right + 10,
        top: rect.top + rect.height / 2,
      });
      return;
    }

    setPosition({
      left: rect.left + rect.width / 2,
      top: rect.bottom + 8,
    });
  };

  useEffect(() => {
    if (!visible) {
      return;
    }
    const onWindowChange = () => updatePosition();
    window.addEventListener("scroll", onWindowChange, true);
    window.addEventListener("resize", onWindowChange);
    return () => {
      window.removeEventListener("scroll", onWindowChange, true);
      window.removeEventListener("resize", onWindowChange);
    };
  }, [visible, side]);

  const transform = useMemo(() => (side === "right" ? "translateY(-50%)" : "translateX(-50%)"), [side]);

  const show = () => {
    updatePosition();
    setVisible(true);
  };

  const hide = () => setVisible(false);

  return (
    <div ref={anchorRef} className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {visible
        ? createPortal(
            <span
              className="pointer-events-none fixed z-[120] whitespace-nowrap rounded-md border border-white/14 bg-black/88 px-2 py-1 text-xs text-paw-text-secondary shadow-lg shadow-black/45 backdrop-blur-md"
              style={{
                left: `${position.left}px`,
                top: `${position.top}px`,
                transform,
              }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </div>
  );
};
