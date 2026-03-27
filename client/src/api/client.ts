import { useAuthStore } from "@/store/authStore";
import type { ApiResponse } from "@/types";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

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

export type UploadProgressStatus = "queued" | "uploading" | "done" | "error";
export type UploadProgressEvent = AttachmentUploadProgressPayload;

export interface MediaUploadResponse {
  attachment_id: string;
  object_key: string;
  download_url: string;
  content_type: string;
  size_bytes: number;
}

const extractErrorMessage = <T>(response: ApiResponse<T>): string => {
  let message = `Request failed with status ${response.status}`;
  if (typeof response.data === "object" && response.data !== null) {
    if ("errors" in response.data && Array.isArray((response.data as { errors?: unknown }).errors)) {
      const firstError = (response.data as { errors: Array<{ loc?: Array<string | number>; msg?: string }> }).errors[0];
      if (firstError) {
        const location = Array.isArray(firstError.loc) ? firstError.loc.join(".") : "body";
        message = `${location}: ${firstError.msg ?? "Validation error"}`;
      }
    } else if ("detail" in response.data) {
      message = String((response.data as { detail: string }).detail);
    }
  }
  return message;
};

const syncTokenFromBridge = async (): Promise<void> => {
  const latestToken = await window.pawcord.auth.getToken();
  const { token, setToken } = useAuthStore.getState();
  if (latestToken !== token) {
    setToken(latestToken);
  }
};

export const apiRequest = async <T>(method: HttpMethod, path: string, body?: unknown): Promise<T> => {
  const response = await window.pawcord.request<T>({ method, path, body });
  await syncTokenFromBridge();
  if (!response.ok) {
    throw new Error(extractErrorMessage(response));
  }
  return response.data;
};

export const get = <T>(path: string): Promise<T> => apiRequest<T>("GET", path);
export const post = <T>(path: string, body?: unknown): Promise<T> => apiRequest<T>("POST", path, body);
export const patch = <T>(path: string, body?: unknown): Promise<T> => apiRequest<T>("PATCH", path, body);
export const del = <T>(path: string): Promise<T> => apiRequest<T>("DELETE", path);

export const uploadAttachments = async (
  messageId: string,
  files: File[],
  onProgress?: (payload: UploadProgressEvent) => void,
): Promise<MediaUploadResponse[]> => {
  const payloadFiles: AttachmentUploadFilePayload[] = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      type: file.type,
      data: await file.arrayBuffer(),
      size: file.size,
      lastModified: file.lastModified,
    })),
  );

  const uploadId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const unsubscribe =
    onProgress !== undefined
      ? window.pawcord.onUploadProgress((payload) => {
          if (payload.uploadId === uploadId) {
            onProgress(payload);
          }
        })
      : null;

  try {
    const response = await window.pawcord.uploadAttachments<MediaUploadResponse[]>({
      uploadId,
      messageId,
      files: payloadFiles,
    });
    await syncTokenFromBridge();

    if (!response.ok) {
      throw new Error(extractErrorMessage(response));
    }

    return response.data;
  } finally {
    if (unsubscribe) {
      unsubscribe();
    }
  }
};

export const uploadAvatar = async <T>(file: File): Promise<T> => {
  const payload: ProfileUploadFilePayload = {
    name: file.name,
    type: file.type,
    data: await file.arrayBuffer(),
    size: file.size,
    lastModified: file.lastModified,
  };

  const response = await window.pawcord.uploadAvatar<T>({ file: payload });
  await syncTokenFromBridge();
  if (!response.ok) {
    throw new Error(extractErrorMessage(response));
  }
  return response.data;
};

export const uploadServerIcon = async <T>(serverId: string, file: File): Promise<T> => {
  const payload: ProfileUploadFilePayload = {
    name: file.name,
    type: file.type,
    data: await file.arrayBuffer(),
    size: file.size,
    lastModified: file.lastModified,
  };

  const response = await window.pawcord.uploadServerIcon<T>({ serverId, file: payload });
  await syncTokenFromBridge();
  if (!response.ok) {
    throw new Error(extractErrorMessage(response));
  }
  return response.data;
};

export const uploadServerBanner = async <T>(serverId: string, file: File): Promise<T> => {
  const payload: ProfileUploadFilePayload = {
    name: file.name,
    type: file.type,
    data: await file.arrayBuffer(),
    size: file.size,
    lastModified: file.lastModified,
  };

  const response = await window.pawcord.uploadServerBanner<T>({ serverId, file: payload });
  await syncTokenFromBridge();
  if (!response.ok) {
    throw new Error(extractErrorMessage(response));
  }
  return response.data;
};

export type { ApiResponse };
