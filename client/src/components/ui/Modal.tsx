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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-[3px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-full max-w-md rounded-2xl border border-white/14 bg-[linear-gradient(180deg,rgba(30,38,50,0.96),rgba(19,24,33,0.96))] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
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
