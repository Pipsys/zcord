import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";

import App from "@/App";
import { queryClient } from "@/api/queryClient";
import { I18nProvider } from "@/i18n/provider";
import "@/styles/globals.css";

// Signal for Electron main process that renderer bootstrap JS has started.
(window as { __RUCORD_RENDERER_BOOTSTRAP?: boolean }).__RUCORD_RENDERER_BOOTSTRAP = true;

const FATAL_OVERLAY_ID = "zcord-fatal-overlay";

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const isRecoverableDomDetachError = (value: unknown): boolean => {
  if (!value) {
    return false;
  }
  if (value instanceof DOMException || value instanceof Error) {
    return value.name === "NotFoundError" && /removeChild/i.test(value.message);
  }
  if (typeof value === "string") {
    return /removeChild/i.test(value) && /not a child/i.test(value);
  }
  return false;
};

const renderFatalScreen = (title: string, details: string) => {
  if (typeof document === "undefined") {
    return;
  }
  let root = document.getElementById(FATAL_OVERLAY_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = FATAL_OVERLAY_ID;
    document.body.appendChild(root);
  }

  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.zIndex = "2147483647";

  root.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:#0f0e14;color:#e8ecf2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;">
      <div style="max-width:780px;width:100%;border:1px solid rgba(255,255,255,0.16);border-radius:14px;background:rgba(18,22,34,.72);padding:20px 24px;">
        <h2 style="margin:0 0 10px;font-size:20px;">${escapeHtml(title)}</h2>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;opacity:.9;">${escapeHtml(details)}</pre>
      </div>
    </div>
  `;
};

window.addEventListener("error", (event) => {
  if (isRecoverableDomDetachError(event.error ?? event.message)) {
    event.preventDefault();
    // eslint-disable-next-line no-console
    console.warn("[renderer] ignored recoverable DOM detach error", event.error ?? event.message);
    return;
  }
  const details = `${event.message}\n${event.filename}:${event.lineno}:${event.colno}`;
  renderFatalScreen("Renderer Error", details);
});

window.addEventListener("unhandledrejection", (event) => {
  if (isRecoverableDomDetachError(event.reason)) {
    event.preventDefault();
    // eslint-disable-next-line no-console
    console.warn("[renderer] ignored recoverable promise DOM detach error", event.reason);
    return;
  }
  const details = event.reason instanceof Error ? `${event.reason.message}\n${event.reason.stack ?? ""}` : String(event.reason);
  renderFatalScreen("Unhandled Promise Rejection", details);
});

try {
  const appTree = (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </I18nProvider>
    </QueryClientProvider>
  );

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    import.meta.env.DEV ? appTree : <React.StrictMode>{appTree}</React.StrictMode>,
  );
} catch (error) {
  const details = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  renderFatalScreen("Bootstrap Error", details);
}
