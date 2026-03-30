import { AnimatePresence, motion } from "framer-motion";
import { Suspense, lazy, useEffect, useRef } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";

import { Sidebar } from "@/components/layout/Sidebar";
import { TitleBar } from "@/components/layout/TitleBar";
import { AppLoader } from "@/components/ui/AppLoader";
import { useI18n } from "@/i18n/provider";
import HomePage from "@/pages/Home";
import LoginPage from "@/pages/Login";
import RegisterPage from "@/pages/Register";
import ServerPage from "@/pages/Server";
import { RealtimeProvider } from "@/realtime/RealtimeProvider";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";

const SettingsPage = lazy(() => import("@/pages/Settings"));

const contentVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
} as const;

const contentTransition = {
  duration: 0.16,
  ease: [0.2, 0, 0, 1],
} as const;

const resolveAppContentKey = (pathname: string): string => {
  if (pathname.startsWith("/app/server/")) {
    return "/app/server";
  }
  if (pathname.startsWith("/app/settings")) {
    return "/app/settings";
  }
  if (pathname.startsWith("/app/home")) {
    return "/app/home";
  }
  return pathname;
};

const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const { t } = useI18n();

  if (!hydrated) {
    return <AppLoader title={t("common.loading")} />;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

const AppShell = () => {
  const { t } = useI18n();
  const location = useLocation();
  const contentKey = `${resolveAppContentKey(location.pathname)}${location.search}`;

  return (
    <ProtectedRoute>
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="min-h-0 flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="min-h-0 flex-1 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={contentKey}
                variants={contentVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={contentTransition}
                className="h-full"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
};

const App = () => {
  const { t } = useI18n();
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrateTheme = useUiStore((state) => state.hydrateTheme);
  const toasts = useUiStore((state) => state.toasts);
  const removeToast = useUiStore((state) => state.removeToast);
  const toastTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    void hydrate();
    hydrateTheme();
  }, [hydrate, hydrateTheme]);

  useEffect(() => {
    const activeIds = new Set(toasts.map((toast) => toast.id));

    for (const toast of toasts) {
      if (toastTimersRef.current.has(toast.id)) {
        continue;
      }

      const timeoutId = window.setTimeout(() => {
        removeToast(toast.id);
        toastTimersRef.current.delete(toast.id);
      }, 2_000);
      toastTimersRef.current.set(toast.id, timeoutId);
    }

    for (const [id, timeoutId] of toastTimersRef.current.entries()) {
      if (activeIds.has(id)) {
        continue;
      }
      window.clearTimeout(timeoutId);
      toastTimersRef.current.delete(id);
    }
  }, [removeToast, toasts]);

  useEffect(
    () => () => {
      for (const timeoutId of toastTimersRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      toastTimersRef.current.clear();
    },
    [],
  );

  return (
    <div className="h-screen overflow-hidden bg-paw-bg-primary text-paw-text-primary">
      <RealtimeProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/app" element={<AppShell />}>
            <Route path="home" element={<HomePage />} />
            <Route path="server/:serverId" element={<ServerPage />} />
            <Route
              path="settings"
              element={
                <Suspense fallback={<AppLoader compact title={t("common.loading_settings")} />}>
                  <SettingsPage />
                </Suspense>
              }
            />
            <Route index element={<Navigate to="home" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/app/home" replace />} />
        </Routes>
      </RealtimeProvider>

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[320px] max-w-[92vw] flex-col gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="popup-toast pointer-events-auto px-3 py-2.5"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-paw-text-primary">{toast.title}</p>
                  {toast.description.trim().length > 0 ? <p className="mt-0.5 line-clamp-2 text-[13px] text-paw-text-secondary">{toast.description}</p> : null}
                </div>
                <button
                  type="button"
                  aria-label="Close toast"
                  onClick={() => removeToast(toast.id)}
                  className="grid h-5 w-5 place-items-center rounded text-sm leading-none text-paw-text-muted transition-colors hover:bg-white/10 hover:text-paw-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paw-accent/35"
                >
                  ×
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default App;
