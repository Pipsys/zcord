import { useEffect, useMemo, useRef, useState, type PropsWithChildren, type ReactNode } from "react";
import { clsx } from "clsx";
import { createPortal } from "react-dom";

interface TooltipProps extends PropsWithChildren {
  label?: string;
  content?: ReactNode;
  side?: "bottom" | "right";
  popupClassName?: string;
}

export const Tooltip = ({ label, content, side = "bottom", popupClassName, children }: TooltipProps) => {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const tooltipContent = content ?? label ?? "";
  const hasTooltipContent = (typeof tooltipContent === "string" ? tooltipContent.trim().length > 0 : Boolean(tooltipContent));

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
    if (!hasTooltipContent) {
      return;
    }
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
              className={clsx(
                "popup-tooltip pointer-events-none fixed z-[120] px-2 py-1 text-xs",
                typeof tooltipContent === "string" ? "whitespace-nowrap" : "whitespace-normal",
                popupClassName,
              )}
              style={{
                left: `${position.left}px`,
                top: `${position.top}px`,
                transform,
              }}
            >
              {tooltipContent}
            </span>,
            document.body,
          )
        : null}
    </div>
  );
};
