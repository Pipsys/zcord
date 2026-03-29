import { AnimatePresence, motion } from "framer-motion";
import { Suspense, lazy, useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { TitleBar } from "@/components/layout/TitleBar";
import { useI18n } from "@/i18n/provider";
import HomePage from "@/pages/Home";
import LoginPage from "@/pages/Login";
import RegisterPage from "@/pages/Register";
import ServerPage from "@/pages/Server";
import { RealtimeProvider } from "@/realtime/RealtimeProvider";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";

const SettingsPage = lazy(() => import("@/pages/Settings"));

const ProtectedRoute = ({ children }: { children: JSX.Element }) => {
  const token = useAuthStore((state) => state.token);
  const hydrated = useAuthStore((state) => state.hydrated);
  const { t } = useI18n();

  if (!hydrated) {
    return <div className="grid h-screen place-items-center bg-paw-bg-primary text-paw-text-secondary">{t("common.loading")}</div>;
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

const App = () => {
  const { t } = useI18n();
  const hydrate = useAuthStore((state) => state.hydrate);
  const hydrateTheme = useUiStore((state) => state.hydrateTheme);
  const toasts = useUiStore((state) => state.toasts);
  const removeToast = useUiStore((state) => state.removeToast);
  const location = useLocation();
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
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6, scale: 0.997, filter: "blur(1px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -4, scale: 1.003, filter: "blur(1px)" }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            className="h-full"
          >
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route
                path="/app/home"
                element={
                  <ProtectedRoute>
                    <div className="flex h-full flex-col">
                      <TitleBar />
                      <HomePage />
                    </div>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/server/:serverId"
                element={
                  <ProtectedRoute>
                    <div className="flex h-full flex-col">
                      <TitleBar />
                      <ServerPage />
                    </div>
                  </ProtectedRoute>
                }
              />
              <Route
                path="/app/settings"
                element={
                  <ProtectedRoute>
                    <div className="flex h-full flex-col">
                      <TitleBar />
                      <Suspense fallback={<div className="grid h-full place-items-center text-paw-text-secondary">{t("common.loading_settings")}</div>}>
                        <SettingsPage />
                      </Suspense>
                    </div>
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/app/home" replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
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
              className="pointer-events-auto rounded-lg border border-white/10 bg-black/22 px-3 py-2.5 shadow-[0_8px_20px_rgba(0,0,0,0.28)] backdrop-blur-sm"
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
                >x</button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default App;
