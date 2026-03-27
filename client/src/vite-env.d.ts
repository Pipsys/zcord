/// <reference types="vite/client" />

interface ApiRequestPayload {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface AttachmentUploadFilePayload {
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

interface PawcordBridge {
  system: {
    platform: string;
  };
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
  };
  clipboard: {
    writeText: (text: string) => Promise<boolean>;
  };
  auth: {
    setToken: (token: string) => Promise<boolean>;
    getToken: () => Promise<string | null>;
    logout: () => Promise<boolean>;
    clearToken: () => Promise<boolean>;
  };
  request: <T>(payload: ApiRequestPayload) => Promise<{ ok: boolean; status: number; data: T }>;
  uploadAvatar: <T>(payload: { file: AttachmentUploadFilePayload }) => Promise<{ ok: boolean; status: number; data: T }>;
  uploadAttachments: <T>(payload: { uploadId: string; messageId: string; files: AttachmentUploadFilePayload[] }) => Promise<{ ok: boolean; status: number; data: T }>;
  onUploadProgress: (handler: (payload: AttachmentUploadProgressPayload) => void) => () => void;
  notify: (title: string, body: string) => Promise<boolean>;
}

interface Window {
  pawcord: PawcordBridge;
}
