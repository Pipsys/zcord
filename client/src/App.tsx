import { AnimatePresence, motion } from "framer-motion";
import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { TitleBar } from "@/components/layout/TitleBar";
import HomePage from "@/pages/Home";
import LoginPage from "@/pages/Login";
import RegisterPage from "@/pages/Register";
import ServerPage from "@/pages/Server";
import { useI18n } from "@/i18n/provider";
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

  useEffect(() => {
    void hydrate();
    hydrateTheme();
  }, [hydrate, hydrateTheme]);

  return (
    <div className="h-screen overflow-hidden bg-paw-bg-primary text-paw-text-primary">
      <AnimatePresence mode="wait">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
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

      <div className="pointer-events-none fixed bottom-4 right-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            className="pointer-events-auto block min-w-64 rounded-lg border border-white/12 bg-black/30 px-4 py-3 text-left shadow-[0_16px_34px_rgba(0,0,0,0.45)] backdrop-blur-sm"
            onClick={() => removeToast(toast.id)}
          >
            <p className="font-semibold text-paw-text-primary">{toast.title}</p>
            <p className="text-sm text-paw-text-secondary">{toast.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
};

export default App;
