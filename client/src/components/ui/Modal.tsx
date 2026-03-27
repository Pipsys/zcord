import type { PropsWithChildren } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface ModalProps extends PropsWithChildren {
  open: boolean;
  title: string;
  onClose: () => void;
}

export const Modal = ({ open, title, onClose, children }: ModalProps) => (
  <AnimatePresence>
    {open ? (
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full max-w-md rounded-lg border border-paw-bg-tertiary bg-paw-bg-elevated p-5 shadow-lg shadow-black/40"
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ type: "spring", stiffness: 250, damping: 20 }}
          onClick={(event) => event.stopPropagation()}
        >
          <h2 className="mb-3 font-display text-xl text-paw-text-primary">{title}</h2>
          {children}
        </motion.div>
      </motion.div>
    ) : null}
  </AnimatePresence>
);
