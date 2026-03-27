import { useEffect, useRef, useState } from "react";

const emojiGroups: Array<{ label: string; items: string[] }> = [
  { label: "faces", items: ["😀", "😄", "😁", "😊", "🙂", "😉", "😍", "🤩", "🤔", "😎", "🥳", "😭", "😡", "😴"] },
  { label: "gestures", items: ["👍", "👎", "👌", "👏", "🙌", "🙏", "🤝", "💪", "🔥", "✨", "💯", "✅", "❌", "🎯"] },
  { label: "animals", items: ["🐶", "🐱", "🐼", "🦊", "🐻", "🐨", "🐯", "🦁", "🐸", "🐵", "🐧", "🦄", "🐾", "🦴"] },
  { label: "food", items: ["🍕", "🍔", "🍟", "🌮", "🍣", "🍩", "🍪", "☕", "🍵", "🥤", "🍺", "🍎", "🍇", "🍓"] },
];

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
}

export const EmojiPicker = ({ onPick }: EmojiPickerProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const container = containerRef.current;
      if (!container || container.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-base text-paw-text-muted hover:text-paw-text-secondary"
        onClick={() => setOpen((value) => !value)}
      >
        😀
      </button>
      {open ? (
        <div className="absolute bottom-11 right-0 z-40 w-[290px] rounded-lg border border-white/10 bg-paw-bg-elevated p-2 shadow-lg shadow-black/40">
          {emojiGroups.map((group) => (
            <div key={group.label} className="mb-1.5 last:mb-0">
              <div className="mb-1 px-1 text-[10px] uppercase tracking-wide text-paw-text-muted">{group.label}</div>
              <div className="grid grid-cols-7 gap-1">
                {group.items.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="rounded-md px-1 py-1 text-lg leading-none hover:bg-black/20"
                    onClick={() => {
                      onPick(emoji);
                      setOpen(false);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
