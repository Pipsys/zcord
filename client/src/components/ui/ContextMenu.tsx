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
    <div className="popup-menu fixed z-50 min-w-44 p-1" style={{ left: x, top: y }}>
      {actions.map((action) => (
        <button
          key={action.id}
          className="popup-menu-item block w-full px-3 py-2 text-left text-sm"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
};
