import { app, BrowserWindow, clipboard, ipcMain, Notification, session } from "electron";
import path from "node:path";
import keytar from "keytar";

import { setupAutoUpdater } from "./updater";

const SERVICE_NAME = "pawcord-desktop";
const ACCESS_ACCOUNT_NAME = "auth-token";
const REFRESH_ACCOUNT_NAME = "refresh-token";
const isMac = process.platform === "darwin";
const useMacCompatibilityMode = process.platform === "darwin";
const ALLOWED_MEDIA_PERMISSIONS = new Set(["media", "audioCapture", "videoCapture", "display-capture"]);

let mainWindow: BrowserWindow | null = null;

// macOS on some integrated GPUs can render an empty/gray window in packaged Electron apps.
// Prefer reliability over GPU acceleration for desktop messenger UI.
if (process.platform === "darwin") {
  app.disableHardwareAcceleration();
}

const BACKEND_CERT_FINGERPRINT = process.env.BACKEND_CERT_FINGERPRINT ?? "";
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const PROD_DEFAULT_DOMAIN = "pawcord.ru";
const PROD_DEFAULT_API_URL = `https://${PROD_DEFAULT_DOMAIN}/api/v1`;

const toByteArray = (value: unknown): Uint8Array => {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return Uint8Array.from(value);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type?: unknown }).type === "Buffer" &&
    "data" in value &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Uint8Array.from((value as { data: number[] }).data);
  }

  throw new Error("Unsupported attachment payload type");
};

const toArrayBuffer = (value: unknown): ArrayBuffer => {
  const bytes = toByteArray(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const normalizeEnvValue = (value: string | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const getApiEndpoint = (): string => {
  const configured = normalizeEnvValue(process.env.BACKEND_API_URL);
  if (configured) {
    return configured;
  }
  return isDev ? "http://localhost:8000/api/v1" : PROD_DEFAULT_API_URL;
};

const toWebSocketOrigin = (origin: string): string => {
  if (origin.startsWith("https://")) {
    return `wss://${origin.slice("https://".length)}`;
  }
  if (origin.startsWith("http://")) {
    return `ws://${origin.slice("http://".length)}`;
  }
  return origin;
};

const getPublicOrigins = (): string[] => {
  const apiOrigin = new URL(getApiEndpoint()).origin;
  const configuredPublicOrigin = normalizeEnvValue(process.env.BACKEND_PUBLIC_ORIGIN);
  const configuredMediaOrigin = normalizeEnvValue(process.env.MEDIA_PUBLIC_ORIGIN);
  const defaults = ["https://pawcord.ru", "https://www.pawcord.ru"];
  return Array.from(
    new Set(
      [apiOrigin, configuredPublicOrigin, configuredMediaOrigin, ...defaults].filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
    ),
  );
};

const buildContentSecurityPolicy = (): string => {
  if (isDev) {
    const publicOrigins = getPublicOrigins();
    const wsOrigins = publicOrigins.map((origin) => toWebSocketOrigin(origin));
    const configuredWsUrl = normalizeEnvValue(process.env.VITE_WS_URL);
    const configuredWsOrigin = configuredWsUrl ? toOrigin(configuredWsUrl) : null;
    const configuredWsFallbackOrigin = configuredWsOrigin ? toWebSocketOrigin(configuredWsOrigin) : null;
    const imageSources = Array.from(
      new Set([
        "'self'",
        "data:",
        "blob:",
        "http://localhost:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:9000",
        "http://127.0.0.1:9000",
        ...publicOrigins,
      ]),
    );
    const mediaSources = Array.from(
      new Set([
        "'self'",
        "data:",
        "blob:",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:9000",
        "http://127.0.0.1:9000",
        ...publicOrigins,
      ]),
    );
    const connectSources = Array.from(
      new Set([
        "'self'",
        "http://localhost:5173",
        "ws://localhost:5173",
        "http://localhost:8000",
        "ws://localhost:8000",
        "ws://127.0.0.1:8000",
        "http://localhost:9000",
        "http://127.0.0.1:9000",
        "https://localhost",
        "wss://localhost",
        ...publicOrigins,
        ...wsOrigins,
        ...(configuredWsOrigin ? [configuredWsOrigin] : []),
        ...(configuredWsFallbackOrigin ? [configuredWsFallbackOrigin] : []),
      ]),
    );

    return `default-src 'self' http://localhost:5173 ws://localhost:5173 data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173; style-src 'self' 'unsafe-inline' http://localhost:5173 https://fonts.googleapis.com; img-src ${imageSources.join(" ")}; media-src ${mediaSources.join(" ")}; connect-src ${connectSources.join(" ")}; font-src 'self' data: https://fonts.gstatic.com;`;
  }

  const publicOrigins = getPublicOrigins();
  const wsOrigins = publicOrigins.map((origin) => toWebSocketOrigin(origin));
  const mediaSources = ["'self'", "data:", "blob:", "file:", ...publicOrigins];
  const connectSources = ["'self'", "https:", "wss:", "http:", "ws:", "file:", "blob:", ...publicOrigins, ...wsOrigins];

  // Packaged Electron renderer runs via file:// and may use blob/module internals.
  // Keep CSP permissive enough to prevent false-positive blank screens.
  return `default-src 'self' file: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' file: blob:; style-src 'self' 'unsafe-inline' file: https://fonts.googleapis.com; img-src ${mediaSources.join(" ")} https:; media-src ${mediaSources.join(" ")} https:; connect-src ${connectSources.join(" ")}; font-src 'self' data: file: https://fonts.gstatic.com;`;
};

const readAccessTokenFromPayload = (data: unknown): string | null => {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const token = (data as { token?: unknown }).token;
  if (typeof token !== "object" || token === null) {
    return null;
  }
  const accessToken = (token as { access_token?: unknown }).access_token;
  return typeof accessToken === "string" && accessToken.length > 0 ? accessToken : null;
};

const readRefreshTokenFromPayload = (data: unknown): string | null => {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const refreshToken = (data as { refresh_token?: unknown }).refresh_token;
  return typeof refreshToken === "string" && refreshToken.length > 0 ? refreshToken : null;
};

const persistTokensFromPayload = async (data: unknown): Promise<void> => {
  const accessToken = readAccessTokenFromPayload(data);
  if (accessToken) {
    await keytar.setPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME, accessToken);
  }

  const refreshToken = readRefreshTokenFromPayload(data);
  if (refreshToken) {
    await keytar.setPassword(SERVICE_NAME, REFRESH_ACCOUNT_NAME, refreshToken);
  }
};

const tryRefreshAccessToken = async (endpoint: string): Promise<boolean> => {
  const refreshToken = await keytar.getPassword(SERVICE_NAME, REFRESH_ACCOUNT_NAME);
  if (!refreshToken) {
    return false;
  }

  const response = await fetch(`${endpoint}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getCsrfHeaders()),
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    return false;
  }

  await persistTokensFromPayload(data);
  return Boolean(readAccessTokenFromPayload(data));
};

const shouldTryRefresh = (path: string): boolean => !path.startsWith("/auth/");

const getAuthScopeUrl = (): string => {
  const endpoint = new URL(getApiEndpoint());
  const basePath = endpoint.pathname.replace(/\/$/, "");
  return `${endpoint.origin}${basePath}/auth`;
};

const getCsrfHeaders = async (): Promise<Record<string, string>> => {
  try {
    const csrfCookie = (await session.defaultSession.cookies.get({ url: getAuthScopeUrl(), name: "csrf_token" }))[0];
    if (!csrfCookie?.value) {
      return {};
    }
    return { "X-CSRF-Token": csrfCookie.value };
  } catch {
    return {};
  }
};

const clearAuthCookies = async (): Promise<void> => {
  const authCookieNames = new Set(["refresh_token", "csrf_token"]);
  const cookies = await session.defaultSession.cookies.get({});
  for (const cookie of cookies) {
    if (!authCookieNames.has(cookie.name)) {
      continue;
    }
    const rawDomain = cookie.domain ?? "";
    if (!rawDomain) {
      continue;
    }
    const domain = rawDomain.startsWith(".") ? rawDomain.slice(1) : rawDomain;
    const url = `${cookie.secure ? "https" : "http"}://${domain}${cookie.path}`;
    try {
      await session.defaultSession.cookies.remove(url, cookie.name);
    } catch {
      // Best-effort cleanup for stale auth cookies.
    }
  }
};

const clearStoredAuth = async (): Promise<boolean> => {
  await keytar.deletePassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
  await keytar.deletePassword(SERVICE_NAME, REFRESH_ACCOUNT_NAME);
  await clearAuthCookies();
  return true;
};

type UploadStatus = "queued" | "uploading" | "done" | "error";

interface UploadProgressPayload {
  uploadId: string;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  fileKey: string;
  index: number;
  totalFiles: number;
  progress: number;
  status: UploadStatus;
  loadedBytes: number;
  totalBytes: number;
}

const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    frame: isMac,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    vibrancy: useMacCompatibilityMode ? undefined : isMac ? "sidebar" : undefined,
    visualEffectState: useMacCompatibilityMode ? undefined : isMac ? "active" : undefined,
    backgroundColor: "#0f0e14",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !useMacCompatibilityMode,
      devTools: process.env.NODE_ENV !== "production",
      webSecurity: true,
    },
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.startsWith("file://")) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const csp = buildContentSecurityPolicy();

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });

  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (!BACKEND_CERT_FINGERPRINT) {
      callback(0);
      return;
    }
    const matches = request.certificate.fingerprint === BACKEND_CERT_FINGERPRINT;
    callback(matches ? 0 : -2);
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const isMainWindow = Boolean(mainWindow && webContents.id === mainWindow.webContents.id);
    callback(isMainWindow && ALLOWED_MEDIA_PERMISSIONS.has(permission));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const isMainWindow = Boolean(mainWindow && webContents && webContents.id === mainWindow.webContents.id);
    return isMainWindow && ALLOWED_MEDIA_PERMISSIONS.has(permission);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    try {
      await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      await mainWindow.loadURL(
        `data:text/html;charset=utf-8,<!doctype html><html><body style="margin:0;background:#0f0e14;color:#e8ecf2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:grid;place-items:center;min-height:100vh;"><div style="max-width:760px;padding:24px 28px;border:1px solid rgba(255,255,255,0.16);border-radius:14px;background:rgba(18,22,34,.72)"><h2 style="margin:0 0 10px;font-size:20px">Renderer failed to load</h2><pre style="margin:0;white-space:pre-wrap;word-break:break-word;opacity:.88">${escaped}</pre></div></body></html>`,
      );
    }
  }

  mainWindow.webContents.on("did-fail-load", async (_event, errorCode, errorDescription, validatedURL) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    const details = `${errorCode} ${errorDescription} ${validatedURL}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    await mainWindow.loadURL(
      `data:text/html;charset=utf-8,<!doctype html><html><body style="margin:0;background:#0f0e14;color:#e8ecf2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:grid;place-items:center;min-height:100vh;"><div style="max-width:760px;padding:24px 28px;border:1px solid rgba(255,255,255,0.16);border-radius:14px;background:rgba(18,22,34,.72)"><h2 style="margin:0 0 10px;font-size:20px">Renderer did-fail-load</h2><pre style="margin:0;white-space:pre-wrap;word-break:break-word;opacity:.88">${details}</pre></div></body></html>`,
    );
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.info("[renderer] did-finish-load");
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level >= 1) {
      // Surface renderer voice/network diagnostics in terminal output too.
      if (level >= 2) {
        console.error(`[renderer:${level}] ${sourceId}:${line} ${message}`);
        return;
      }
      console.log(`[renderer:${level}] ${sourceId}:${line} ${message}`);
    }
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[renderer] process gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });

  // If bundle JS never boots (blank/gray screen), replace with explicit diagnostics.
  setTimeout(async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    try {
      const started = await mainWindow.webContents.executeJavaScript(
        "Boolean(window.__RUCORD_RENDERER_BOOTSTRAP)",
        true,
      );
      if (started) {
        console.info("[renderer] bootstrap flag detected");
        return;
      }
      await mainWindow.loadURL(
        "data:text/html;charset=utf-8,<!doctype html><html><body style='margin:0;background:#0f0e14;color:#e8ecf2;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh'><div style='max-width:760px;padding:24px 28px;border:1px solid rgba(255,255,255,0.16);border-radius:14px;background:rgba(18,22,34,.72)'><h2 style='margin:0 0 10px;font-size:20px'>Renderer JS did not start</h2><pre style='margin:0;white-space:pre-wrap;word-break:break-word;opacity:.88'>The app loaded HTML but renderer bootstrap flag was not set. This usually means stale build artifacts or blocked JS execution in packaged app.</pre></div></body></html>",
      );
    } catch (error) {
      const details = (error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error))
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      await mainWindow.loadURL(
        `data:text/html;charset=utf-8,<!doctype html><html><body style="margin:0;background:#0f0e14;color:#e8ecf2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:grid;place-items:center;min-height:100vh;"><div style="max-width:760px;padding:24px 28px;border:1px solid rgba(255,255,255,0.16);border-radius:14px;background:rgba(18,22,34,.72)"><h2 style="margin:0 0 10px;font-size:20px">Renderer health-check failed</h2><pre style="margin:0;white-space:pre-wrap;word-break:break-word;opacity:.88">${details}</pre></div></body></html>`,
      );
    }
  }, 3500);

  setupAutoUpdater();
};

app.on("certificate-error", (event, _webContents, _url, _error, certificate, callback) => {
  if (BACKEND_CERT_FINGERPRINT && certificate.fingerprint !== BACKEND_CERT_FINGERPRINT) {
    event.preventDefault();
    callback(false);
    return;
  }
  callback(true);
});

app.whenReady().then(async () => {
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("window:minimize", () => mainWindow?.minimize());
ipcMain.handle("window:maximize", () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});
ipcMain.handle("window:close", () => mainWindow?.close());
ipcMain.handle("clipboard:write-text", (_event, text: string) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle("auth:set-token", async (_event, token: string) => {
  await keytar.setPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME, token);
  return true;
});

ipcMain.handle("auth:get-token", async () => {
  return keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
});

ipcMain.handle("auth:logout", async () => {
  const endpoint = getApiEndpoint();
  let accessToken = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
  let refreshToken = await keytar.getPassword(SERVICE_NAME, REFRESH_ACCOUNT_NAME);

  const executeLogout = async (currentAccessToken: string | null, currentRefreshToken: string | null) =>
    fetch(`${endpoint}/auth/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getCsrfHeaders()),
        ...(currentAccessToken ? { Authorization: `Bearer ${currentAccessToken}` } : {}),
      },
      body: currentRefreshToken ? JSON.stringify({ refresh_token: currentRefreshToken }) : undefined,
    });

  try {
    if (!accessToken && refreshToken) {
      const refreshed = await tryRefreshAccessToken(endpoint);
      if (refreshed) {
        accessToken = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
        refreshToken = await keytar.getPassword(SERVICE_NAME, REFRESH_ACCOUNT_NAME);
      }
    }

    if (accessToken || refreshToken) {
      let response = await executeLogout(accessToken, refreshToken);
      if (response.status === 401 && refreshToken) {
        const refreshed = await tryRefreshAccessToken(endpoint);
        if (refreshed) {
          accessToken = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
          refreshToken = await keytar.getPassword(SERVICE_NAME, REFRESH_ACCOUNT_NAME);
          response = await executeLogout(accessToken, refreshToken);
        }
      }
      void response;
    }
  } catch {
    // Local cleanup still happens even if the server-side logout fails.
  } finally {
    await clearStoredAuth();
  }

  return true;
});

ipcMain.handle("auth:clear-token", async () => {
  return clearStoredAuth();
});

ipcMain.handle("notify:show", async (_event, payload: { title: string; body: string }) => {
  if (Notification.isSupported()) {
    new Notification({ title: payload.title, body: payload.body }).show();
  }
  return true;
});

ipcMain.handle("api:request", async (_event, payload: { method: string; path: string; body?: unknown; headers?: Record<string, string> }) => {
  let token = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
  const endpoint = getApiEndpoint();
  const url = `${endpoint}${payload.path}`;

  const buildHeaders = (accessToken: string | null): Record<string, string> => ({
    "Content-Type": "application/json",
    ...(payload.headers ?? {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  });

  const execute = async (accessToken: string | null) => fetch(url, {
    method: payload.method,
    headers: buildHeaders(accessToken),
    body: payload.body ? JSON.stringify(payload.body) : undefined,
  });

  let response = await execute(token);
  let data = await parseJsonResponse(response);

  if (response.status === 401 && shouldTryRefresh(payload.path)) {
    const refreshed = await tryRefreshAccessToken(endpoint);
    if (refreshed) {
      token = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
      response = await execute(token);
      data = await parseJsonResponse(response);
    }
  }

  if (response.ok) {
    await persistTokensFromPayload(data);
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
});

ipcMain.handle(
  "api:upload-avatar",
  async (
    _event,
    payload: { file: { name: string; type: string; data: ArrayBuffer; size: number; lastModified: number } },
  ) => {
    let token = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
    const endpoint = getApiEndpoint();
    const executeUpload = async (accessToken: string | null) => {
      const formData = new FormData();
      const binary = toArrayBuffer(payload.file.data);
      const blob = new Blob([binary], { type: payload.file.type || "application/octet-stream" });
      formData.append("file", blob, payload.file.name);
      return fetch(`${endpoint}/users/me/avatar`, {
        method: "POST",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        body: formData,
      });
    };

    let response = await executeUpload(token);
    let data = await parseJsonResponse(response);

    if (response.status === 401) {
      const refreshed = await tryRefreshAccessToken(endpoint);
      if (refreshed) {
        token = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
        response = await executeUpload(token);
        data = await parseJsonResponse(response);
      }
    }

    if (response.ok) {
      await persistTokensFromPayload(data);
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  },
);

ipcMain.handle(
  "api:upload-server-icon",
  async (
    _event,
    payload: { serverId: string; file: { name: string; type: string; data: ArrayBuffer; size: number; lastModified: number } },
  ) => {
    let token = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
    const endpoint = getApiEndpoint();
    const executeUpload = async (accessToken: string | null) => {
      const formData = new FormData();
      const binary = toArrayBuffer(payload.file.data);
      const blob = new Blob([binary], { type: payload.file.type || "application/octet-stream" });
      formData.append("file", blob, payload.file.name);
      return fetch(`${endpoint}/servers/${encodeURIComponent(payload.serverId)}/icon`, {
        method: "POST",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        body: formData,
      });
    };

    let response = await executeUpload(token);
    let data = await parseJsonResponse(response);

    if (response.status === 401) {
      const refreshed = await tryRefreshAccessToken(endpoint);
      if (refreshed) {
        token = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
        response = await executeUpload(token);
        data = await parseJsonResponse(response);
      }
    }

    if (response.ok) {
      await persistTokensFromPayload(data);
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  },
);

ipcMain.handle(
  "api:upload-server-banner",
  async (
    _event,
    payload: { serverId: string; file: { name: string; type: string; data: ArrayBuffer; size: number; lastModified: number } },
  ) => {
    let token = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
    const endpoint = getApiEndpoint();
    const executeUpload = async (accessToken: string | null) => {
      const formData = new FormData();
      const binary = toArrayBuffer(payload.file.data);
      const blob = new Blob([binary], { type: payload.file.type || "application/octet-stream" });
      formData.append("file", blob, payload.file.name);
      return fetch(`${endpoint}/servers/${encodeURIComponent(payload.serverId)}/banner`, {
        method: "POST",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        body: formData,
      });
    };

    let response = await executeUpload(token);
    let data = await parseJsonResponse(response);

    if (response.status === 401) {
      const refreshed = await tryRefreshAccessToken(endpoint);
      if (refreshed) {
        token = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
        response = await executeUpload(token);
        data = await parseJsonResponse(response);
      }
    }

    if (response.ok) {
      await persistTokensFromPayload(data);
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  },
);

ipcMain.handle(
  "api:upload-attachments",
  async (
    event,
    payload: { uploadId: string; messageId: string; files: Array<{ name: string; type: string; data: ArrayBuffer; size: number; lastModified: number }> },
  ) => {
    let token = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
    const endpoint = getApiEndpoint();
    const results: unknown[] = [];
    const totalFiles = payload.files.length;

    const emitProgress = (entry: UploadProgressPayload) => {
      event.sender.send("api:upload-progress", entry);
    };

    payload.files.forEach((file, index) => {
      const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
      emitProgress({
        uploadId: payload.uploadId,
        fileName: file.name,
        fileSize: file.size,
        fileLastModified: file.lastModified,
        fileKey,
        index,
        totalFiles,
        progress: 0,
        status: "queued",
        loadedBytes: 0,
        totalBytes: file.size,
      });
    });

    for (const [index, file] of payload.files.entries()) {
      const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
      let simulatedProgress = 5;
      emitProgress({
        uploadId: payload.uploadId,
        fileName: file.name,
        fileSize: file.size,
        fileLastModified: file.lastModified,
        fileKey,
        index,
        totalFiles,
        progress: simulatedProgress,
        status: "uploading",
        loadedBytes: Math.round(file.size * (simulatedProgress / 100)),
        totalBytes: file.size,
      });

      const progressStep = file.size > 20 * 1024 * 1024 ? 2 : file.size > 8 * 1024 * 1024 ? 3 : 5;
      const progressIntervalMs = 180;
      let progressTimer: NodeJS.Timeout | null = setInterval(() => {
        simulatedProgress = Math.min(92, simulatedProgress + progressStep);
        emitProgress({
          uploadId: payload.uploadId,
          fileName: file.name,
          fileSize: file.size,
          fileLastModified: file.lastModified,
          fileKey,
          index,
          totalFiles,
          progress: simulatedProgress,
          status: "uploading",
          loadedBytes: Math.round(file.size * (simulatedProgress / 100)),
          totalBytes: file.size,
        });
      }, progressIntervalMs);

      const executeUpload = async (accessToken: string | null) => {
        const formData = new FormData();
        const binary = toArrayBuffer(file.data);
        const blob = new Blob([binary], { type: file.type || "application/octet-stream" });
        formData.append("file", blob, file.name);
        return fetch(`${endpoint}/media/upload?message_id=${encodeURIComponent(payload.messageId)}`, {
          method: "POST",
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
          body: formData,
        });
      };

      let response: Response;
      let data: unknown;
      try {
        response = await executeUpload(token);
        data = await parseJsonResponse(response);

        if (response.status === 401) {
          const refreshed = await tryRefreshAccessToken(endpoint);
          if (refreshed) {
            token = await keytar.getPassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
            response = await executeUpload(token);
            data = await parseJsonResponse(response);
          }
        }
      } catch (error) {
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
        emitProgress({
          uploadId: payload.uploadId,
          fileName: file.name,
          fileSize: file.size,
          fileLastModified: file.lastModified,
          fileKey,
          index,
          totalFiles,
          progress: Math.max(simulatedProgress, 5),
          status: "error",
          loadedBytes: Math.round(file.size * (simulatedProgress / 100)),
          totalBytes: file.size,
        });
        return {
          ok: false,
          status: 503,
          data: {
            detail: error instanceof Error ? error.message : "Upload failed",
          },
        };
      } finally {
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      }

      if (!response.ok) {
        emitProgress({
          uploadId: payload.uploadId,
          fileName: file.name,
          fileSize: file.size,
          fileLastModified: file.lastModified,
          fileKey,
          index,
          totalFiles,
          progress: 100,
          status: "error",
          loadedBytes: Math.round(file.size * (simulatedProgress / 100)),
          totalBytes: file.size,
        });
        return {
          ok: false,
          status: response.status,
          data,
        };
      }

      emitProgress({
        uploadId: payload.uploadId,
        fileName: file.name,
        fileSize: file.size,
        fileLastModified: file.lastModified,
        fileKey,
        index,
        totalFiles,
        progress: 100,
        status: "done",
        loadedBytes: file.size,
        totalBytes: file.size,
      });
      results.push(data);
    }

    return {
      ok: true,
      status: 201,
      data: results,
    };
  },
);
