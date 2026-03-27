import { app, BrowserWindow, clipboard, ipcMain, Notification, session } from "electron";
import path from "node:path";
import keytar from "keytar";

import { setupAutoUpdater } from "./updater";

const SERVICE_NAME = "pawcord-desktop";
const ACCESS_ACCOUNT_NAME = "auth-token";
const REFRESH_ACCOUNT_NAME = "refresh-token";

let mainWindow: BrowserWindow | null = null;

const BACKEND_CERT_FINGERPRINT = process.env.BACKEND_CERT_FINGERPRINT ?? "";
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

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

const getApiEndpoint = (): string => process.env.BACKEND_API_URL ?? (isDev ? "http://localhost:8000/api/v1" : "https://localhost/api/v1");

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
    frame: false,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f0e14",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: process.env.NODE_ENV !== "production",
      webSecurity: true,
    },
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self' http://localhost:5173 ws://localhost:5173 data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173; style-src 'self' 'unsafe-inline' http://localhost:5173 https://fonts.googleapis.com; img-src 'self' data: blob: http://localhost:5173 http://localhost:8000 http://127.0.0.1:8000 http://localhost:9000 http://127.0.0.1:9000; media-src 'self' data: blob: http://localhost:8000 http://127.0.0.1:8000 http://localhost:9000 http://127.0.0.1:9000; connect-src 'self' http://localhost:5173 ws://localhost:5173 http://localhost:8000 ws://localhost:8000 ws://127.0.0.1:8000 http://localhost:9000 http://127.0.0.1:9000 https://localhost wss://localhost; font-src 'self' data: https://fonts.gstatic.com;"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://localhost:8000 http://127.0.0.1:8000 http://localhost:9000 http://127.0.0.1:9000; media-src 'self' data: blob: http://localhost:8000 http://127.0.0.1:8000 http://localhost:9000 http://127.0.0.1:9000; connect-src 'self' http://localhost:8000 ws://localhost:8000 ws://127.0.0.1:8000 http://localhost:9000 http://127.0.0.1:9000 https://localhost wss://localhost; font-src 'self' data:;";

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

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

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

ipcMain.handle("auth:clear-token", async () => {
  await keytar.deletePassword(SERVICE_NAME, ACCESS_ACCOUNT_NAME);
  await keytar.deletePassword(SERVICE_NAME, REFRESH_ACCOUNT_NAME);
  return true;
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
