import { contextBridge, ipcRenderer } from "electron";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface ApiRequestPayload {
  method: HttpMethod;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

interface AttachmentUploadFilePayload {
  name: string;
  type: string;
  data: ArrayBuffer;
  size: number;
  lastModified: number;
}

interface ProfileUploadFilePayload {
  name: string;
  type: string;
  data: ArrayBuffer;
  size: number;
  lastModified: number;
}

type AttachmentUploadStatus = "queued" | "uploading" | "done" | "error";

interface AttachmentUploadProgressPayload {
  uploadId: string;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  fileKey: string;
  index: number;
  totalFiles: number;
  progress: number;
  status: AttachmentUploadStatus;
  loadedBytes: number;
  totalBytes: number;
}

interface ScreenShareSourcePayload {
  id: string;
  name: string;
  displayId: string;
  kind: "screen" | "window";
  thumbnailDataUrl: string | null;
  appIconDataUrl: string | null;
}

type UpdaterStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

interface UpdaterStatePayload {
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

const pawcordApi = {
  system: {
    platform: process.platform,
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke("clipboard:write-text", text) as Promise<boolean>,
  },
  media: {
    listScreenSources: () => ipcRenderer.invoke("screen-share:list-sources") as Promise<ScreenShareSourcePayload[]>,
    selectScreenSource: (sourceId: string | null) => ipcRenderer.invoke("screen-share:select-source", sourceId) as Promise<boolean>,
  },
  auth: {
    setToken: (token: string) => ipcRenderer.invoke("auth:set-token", token),
    getToken: () => ipcRenderer.invoke("auth:get-token") as Promise<string | null>,
    logout: () => ipcRenderer.invoke("auth:logout") as Promise<boolean>,
    clearToken: () => ipcRenderer.invoke("auth:clear-token"),
  },
  request: <T>(payload: ApiRequestPayload) => ipcRenderer.invoke("api:request", payload) as Promise<ApiResponse<T>>,
  uploadAvatar: <T>(payload: { file: ProfileUploadFilePayload }) => ipcRenderer.invoke("api:upload-avatar", payload) as Promise<ApiResponse<T>>,
  uploadUserBanner: <T>(payload: { file: ProfileUploadFilePayload }) =>
    ipcRenderer.invoke("api:upload-user-banner", payload) as Promise<ApiResponse<T>>,
  uploadServerIcon: <T>(payload: { serverId: string; file: ProfileUploadFilePayload }) =>
    ipcRenderer.invoke("api:upload-server-icon", payload) as Promise<ApiResponse<T>>,
  uploadServerBanner: <T>(payload: { serverId: string; file: ProfileUploadFilePayload }) =>
    ipcRenderer.invoke("api:upload-server-banner", payload) as Promise<ApiResponse<T>>,
  uploadAttachments: <T>(payload: { uploadId: string; messageId: string; files: AttachmentUploadFilePayload[] }) =>
    ipcRenderer.invoke("api:upload-attachments", payload) as Promise<ApiResponse<T>>,
  onUploadProgress: (handler: (payload: AttachmentUploadProgressPayload) => void) => {
    const listener = (_event: unknown, payload: AttachmentUploadProgressPayload) => {
      handler(payload);
    };
    ipcRenderer.on("api:upload-progress", listener);
    return () => ipcRenderer.removeListener("api:upload-progress", listener);
  },
  updater: {
    getState: () => ipcRenderer.invoke("updater:get-state") as Promise<UpdaterStatePayload>,
    checkForUpdates: () => ipcRenderer.invoke("updater:check") as Promise<UpdaterStatePayload>,
    downloadUpdate: () => ipcRenderer.invoke("updater:download") as Promise<UpdaterStatePayload>,
    installUpdate: () => ipcRenderer.invoke("updater:install") as Promise<UpdaterStatePayload>,
    onStateChange: (handler: (payload: UpdaterStatePayload) => void) => {
      const listener = (_event: unknown, payload: UpdaterStatePayload) => {
        handler(payload);
      };
      ipcRenderer.on("updater:state", listener);
      return () => ipcRenderer.removeListener("updater:state", listener);
    },
  },
  notify: (title: string, body: string) => ipcRenderer.invoke("notify:show", { title, body }),
};

contextBridge.exposeInMainWorld("pawcord", pawcordApi);
