/**
 * 檔案上傳（M2-B 交付物 12）。
 *
 * 走 `POST /api/files/upload`（multipart：workspaceId + file）。
 * 用 XMLHttpRequest 而不是 fetch，因為只有 XHR 有 `upload.onprogress`
 * （fetch 的 ReadableStream 上傳進度在瀏覽器支援度上還不夠）。
 *
 * ⚠️ 這裡是唯一允許直接打上傳 API 的地方；block 的變更一律走 transaction。
 */
import type { ApiSuccessResponse, FileMeta } from '@kennote/shared-types';
import { API_ROUTES } from '@kennote/shared-types';
import { ApiError, getAccessToken } from './api-client';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/** 單一檔案上限：25MB（超過在前端就擋下，不要浪費使用者的頻寬） */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface UploadHandle {
  promise: Promise<FileMeta>;
  abort(): void;
}

export interface UploadOptions {
  onProgress?(percent: number): void;
  signal?: AbortSignal;
  /**
   * 這個附件要掛在哪一頁（第九輪 / migration 0070）。
   * 後端存進 `files.page_id`，之後 `GET /api/files/:id` 就**依那一頁的權限**放行 ——
   * 沒帶的話退回「工作區成員限定」，同工作區的 guest 拿得到私密頁面的附件。
   * **頭像刻意不帶**（不屬於任何頁面）。
   */
  pageId?: string | null;
}

export function uploadFile(
  workspaceId: string,
  file: File,
  options: UploadOptions = {},
): UploadHandle {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<FileMeta>((resolve, reject) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      reject(
        new ApiError(413, {
          code: 'PAYLOAD_TOO_LARGE',
          message: `檔案超過 ${formatBytes(MAX_UPLOAD_BYTES)} 上限`,
        }),
      );
      return;
    }

    const form = new FormData();
    form.append('workspaceId', workspaceId);
    if (options.pageId) form.append('pageId', options.pageId);
    form.append('file', file, file.name);

    xhr.open('POST', `${BASE_URL}${API_ROUTES.fileUpload}`);
    xhr.withCredentials = true;
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.(Math.round((event.loaded / event.total) * 100));
    });

    xhr.addEventListener('load', () => {
      let payload: unknown;
      try {
        payload = JSON.parse(xhr.responseText) as unknown;
      } catch {
        reject(new ApiError(xhr.status, { code: 'INTERNAL_ERROR', message: '上傳回應格式錯誤' }));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const shape = (payload as { error?: { code: string; message: string } }).error;
        reject(
          new ApiError(xhr.status, {
            code: (shape?.code as ApiError['code']) ?? 'INTERNAL_ERROR',
            message: shape?.message ?? '上傳失敗',
          }),
        );
        return;
      }
      options.onProgress?.(100);
      resolve((payload as ApiSuccessResponse<FileMeta>).data);
    });

    xhr.addEventListener('error', () => {
      reject(new ApiError(0, { code: 'INTERNAL_ERROR', message: '上傳失敗，請檢查網路' }));
    });
    xhr.addEventListener('abort', () => {
      reject(new ApiError(0, { code: 'INTERNAL_ERROR', message: '上傳已取消' }));
    });

    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });

  return { promise, abort: () => xhr.abort() };
}

/** 給 <img src> 用：優先用後端回的 url，退回 /api/files/:id */
export function fileUrl(meta: { id: string; url?: string | null }): string {
  if (meta.url) return meta.url;
  return `${BASE_URL}${API_ROUTES.file(meta.id)}`;
}

/** block.props 存的是 fileId 或 externalUrl，這裡統一解析成可顯示的 URL */
export function resolveMediaUrl(props: {
  fileId?: string | null;
  externalUrl?: string | null;
}): string | null {
  if (props.externalUrl) return props.externalUrl;
  if (props.fileId) return `${BASE_URL}${API_ROUTES.file(props.fileId)}`;
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/');
}
