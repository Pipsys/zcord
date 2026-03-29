import { motion } from "framer-motion";

interface AppLoaderProps {
  title: string;
  subtitle?: string;
  compact?: boolean;
}

export const AppLoader = ({ title, subtitle, compact = false }: AppLoaderProps) => {
  return (
    <div className={`grid w-full place-items-center ${compact ? "h-full py-8" : "h-full min-h-[280px] px-4"}`}>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="relative h-16 w-16">
          <motion.span
            className="absolute inset-0 rounded-full border border-white/15"
            animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.9, 0.4] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.span
            className="absolute inset-1 rounded-full border border-paw-accent/45"
            animate={{ rotate: 360 }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
          />
          <motion.span
            className="absolute inset-[17px] rounded-full bg-paw-accent shadow-[0_0_24px_rgba(88,101,242,0.48)]"
            animate={{ scale: [0.9, 1.1, 0.9] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <div className="space-y-1.5">
          <motion.p
            className="text-sm font-semibold text-paw-text-secondary"
            animate={{ opacity: [0.72, 1, 0.72] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          >
            {title}
          </motion.p>
          {subtitle ? <p className="text-xs text-paw-text-muted">{subtitle}</p> : null}
        </div>

        <motion.div
          className="h-1.5 w-40 overflow-hidden rounded-full bg-white/10"
          initial={false}
          animate={{ opacity: [0.65, 1, 0.65] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
        >
          <motion.span
            className="block h-full rounded-full bg-gradient-to-r from-paw-accent/20 via-paw-accent to-paw-accent/20"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      </div>
    </div>
  );
};

