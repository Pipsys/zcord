import type { ReactNode } from "react";

interface ContextAction {
  id: string;
  label: string;
  onClick: () => void;
}

interface ContextMenuProps {
  visible: boolean;
  x: number;
  y: number;
  actions: ContextAction[];
}

export const ContextMenu = ({ visible, x, y, actions }: ContextMenuProps): ReactNode => {
  if (!visible) {
    return null;
  }

  return (
    <div className="fixed z-50 min-w-44 rounded-md border border-white/10 bg-black/30 p-1 shadow-lg shadow-black/40 backdrop-blur-sm" style={{ left: x, top: y }}>
      {actions.map((action) => (
        <button
          key={action.id}
          className="block w-full rounded px-3 py-2 text-left text-sm text-paw-text-secondary transition hover:bg-white/10 hover:text-paw-text-primary"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
};
