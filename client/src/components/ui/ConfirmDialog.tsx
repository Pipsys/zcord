import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  cancelText: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmText,
  cancelText,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const root = typeof document !== "undefined" ? document.body : null;
  if (!root) {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="popup-overlay fixed inset-0 z-[400] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onCancel}
        >
          <motion.div
            className="popup-surface w-full max-w-md p-4"
            initial={{ y: 10, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 10, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start gap-3">
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#8b2f42]/55 bg-[#6b2434]/55 text-[#ffb0bd]">
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.9]">
                  <path d="M5 7h14" />
                  <path d="M9 7V5h6v2" />
                  <path d="m8 7 1 12h6l1-12" />
                </svg>
              </div>

              <div className="min-w-0">
                <h3 className="text-base font-semibold text-paw-text-primary">{title}</h3>
                <p className="mt-1 text-sm leading-5 text-paw-text-muted">{description}</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={loading}
                className="popup-btn-secondary px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                onClick={onCancel}
              >
                {cancelText}
              </button>
              <button
                type="button"
                disabled={loading}
                className="rounded-md border border-[#b3354b] bg-[#cc3d56] px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-[#db4a64] disabled:cursor-not-allowed disabled:opacity-60"
                onClick={onConfirm}
              >
                {loading ? "..." : confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    root,
  );
};
