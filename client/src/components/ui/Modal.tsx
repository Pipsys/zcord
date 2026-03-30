import type { PropsWithChildren } from "react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";

interface ModalProps extends PropsWithChildren {
  open: boolean;
  title: string;
  onClose: () => void;
  className?: string;
}

export const Modal = ({ open, title, onClose, children, className }: ModalProps) => (
  <AnimatePresence>
    {open ? (
      <motion.div
        className="popup-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className={clsx("popup-surface w-full max-w-md p-5", className)}
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          onClick={(event) => event.stopPropagation()}
        >
          <h2 className="mb-3 font-display text-xl text-paw-text-primary">{title}</h2>
          {children}
        </motion.div>
      </motion.div>
    ) : null}
  </AnimatePresence>
);
