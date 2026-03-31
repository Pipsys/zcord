import { app, BrowserWindow, ipcMain } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { autoUpdater } from "electron-updater";

export type UpdaterStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export interface UpdaterState {
  enabled: boolean;
  status: UpdaterStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  checkedAt: string | null;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  message: string | null;
}

const STATE_CHANNEL = "updater:state";

let initialized = false;

let state: UpdaterState = {
  enabled: false,
  status: "disabled",
  currentVersion: app.getVersion(),
  latestVersion: null,
  releaseName: null,
  releaseDate: null,
  releaseNotes: null,
  checkedAt: null,
  progressPercent: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  message: "In-app update is unavailable.",
};

const broadcastState = () => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(STATE_CHANNEL, state);
    }
  }
};

const setState = (patch: Partial<UpdaterState>) => {
  state = { ...state, ...patch };
  broadcastState();
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseReleaseNotes = (value: unknown): string | null => {
  if (typeof value === "string") {
    return asText(value);
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const lines = value
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }
      if (typeof item === "object" && item !== null && "note" in item) {
        const note = (item as { note?: unknown }).note;
        return typeof note === "string" ? note.trim() : "";
      }
      return "";
    })
    .filter((line) => line.length > 0);

  return lines.length > 0 ? lines.join("\n\n") : null;
};

const applyUpdateInfo = (info: unknown) => {
  if (typeof info !== "object" || info === null) {
    return;
  }

  const payload = info as Record<string, unknown>;
  const version = asText(payload.version);
  const releaseName = asText(payload.releaseName);
  const releaseDate = asText(payload.releaseDate);
  const releaseNotes = parseReleaseNotes(payload.releaseNotes);

  setState({
    latestVersion: version ?? state.latestVersion,
    releaseName: releaseName ?? state.releaseName,
    releaseDate: releaseDate ?? state.releaseDate,
    releaseNotes: releaseNotes ?? state.releaseNotes,
  });
};

const initAvailability = () => {
  if (!app.isPackaged) {
    setState({
      enabled: false,
      status: "disabled",
      message: "In-app updates are disabled in development builds.",
    });
    return;
  }

  const updateConfigPath = path.join(process.resourcesPath, "app-update.yml");
  if (!existsSync(updateConfigPath)) {
    setState({
      enabled: false,
      status: "disabled",
      message: `Missing update config: ${updateConfigPath}`,
    });
    return;
  }

  setState({
    enabled: true,
    status: "idle",
    message: null,
  });
};

const checkForUpdatesInternal = async (): Promise<UpdaterState> => {
  if (!state.enabled) {
    return state;
  }

  if (state.status === "checking" || state.status === "downloading" || state.status === "installing") {
    return state;
  }

  setState({
    status: "checking",
    checkedAt: new Date().toISOString(),
    message: null,
  });

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setState({
      status: "error",
      message: getErrorMessage(error),
    });
  }

  return state;
};

const downloadUpdateInternal = async (): Promise<UpdaterState> => {
  if (!state.enabled) {
    return state;
  }

  if (state.status === "downloading" || state.status === "installing" || state.status === "downloaded") {
    return state;
  }

  if (state.status !== "available") {
    setState({
      message: "No update available to download.",
    });
    return state;
  }

  setState({
    status: "downloading",
    progressPercent: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    message: null,
  });

  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    setState({
      status: "error",
      message: getErrorMessage(error),
    });
  }

  return state;
};

const installUpdateInternal = (): UpdaterState => {
  if (!state.enabled || state.status !== "downloaded") {
    return state;
  }

  setState({
    status: "installing",
    message: "Restarting to install update...",
  });

  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true);
  }, 250);

  return state;
};

const registerUpdaterEvents = () => {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    setState({
      status: "checking",
      checkedAt: new Date().toISOString(),
      message: null,
    });
  });

  autoUpdater.on("update-available", (info) => {
    applyUpdateInfo(info);
    setState({
      status: "available",
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      message: null,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    applyUpdateInfo(info);
    setState({
      status: "not-available",
      latestVersion: state.latestVersion ?? state.currentVersion,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      message: null,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const downloaded = Number.isFinite(progress.transferred) ? progress.transferred : 0;
    const total = Number.isFinite(progress.total) ? progress.total : 0;
    const percentRaw = Number.isFinite(progress.percent) ? progress.percent : 0;
    const percent = Math.max(0, Math.min(100, percentRaw));

    setState({
      status: "downloading",
      progressPercent: percent,
      downloadedBytes: downloaded,
      totalBytes: total,
      message: null,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    applyUpdateInfo(info);
    setState({
      status: "downloaded",
      progressPercent: 100,
      downloadedBytes: state.totalBytes > 0 ? state.totalBytes : state.downloadedBytes,
      message: null,
    });
  });

  autoUpdater.on("error", (error) => {
    setState({
      status: "error",
      message: getErrorMessage(error),
    });
    console.warn("[updater] error:", error);
  });
};

const registerIpc = () => {
  ipcMain.handle("updater:get-state", () => state);
  ipcMain.handle("updater:check", async () => checkForUpdatesInternal());
  ipcMain.handle("updater:download", async () => downloadUpdateInternal());
  ipcMain.handle("updater:install", () => installUpdateInternal());
};

export const setupAutoUpdater = (): void => {
  if (initialized) {
    broadcastState();
    return;
  }

  initialized = true;
  initAvailability();
  registerIpc();

  if (!state.enabled) {
    return;
  }

  registerUpdaterEvents();
  void checkForUpdatesInternal();
};
