/**
 * fetch wrapper：統一錯誤形狀 + access token 自動 refresh（04 §8 M1 交付物 10）。
 *
 * 契約（與後端 04 §5.3 一致）：
 *   成功 → { data, meta? }
 *   失敗 → { error: { code, message, details? } }
 *
 * token 策略（04 §5.5）：
 *   access token 只存在**記憶體**（下面的模組變數），重新整理就沒了；
 *   refresh token 在 HttpOnly cookie，靠 bootstrap 時打一次 /refresh 把登入狀態撿回來。
 */
import type { ApiErrorShape, ApiSuccessResponse, ErrorCode } from '@kennote/shared-types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(status: number, shape: ApiErrorShape) {
    super(shape.message);
    this.name = 'ApiError';
    this.code = shape.code;
    this.status = status;
    if (shape.details) this.details = shape.details;
  }
}

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/** 多個請求同時 401 時只會打一次 /refresh */
let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return false;
        const body = (await res.json()) as ApiSuccessResponse<{ accessToken: string }>;
        accessToken = body.data.accessToken;
        return true;
      } catch {
        return false;
      } finally {
        // 讓下一輪重新嘗試，但這一輪的併發請求共用同一個結果
        setTimeout(() => {
          refreshPromise = null;
        }, 0);
      }
    })();
  }
  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** multipart 上傳時直接給 FormData */
  formData?: FormData;
  /** 內部用：避免 refresh 無限遞迴 */
  skipRefresh?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers,
  };
  if (options.formData) init.body = options.formData;
  else if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), init);
  } catch {
    throw new ApiError(0, { code: 'INTERNAL_ERROR', message: '連線失敗，請檢查網路' });
  }

  // 401 → 自動 refresh 一次，成功就重試原請求
  if (res.status === 401 && !options.skipRefresh) {
    const ok = await refreshAccessToken();
    if (ok) return request<T>(path, { ...options, skipRefresh: true });
    accessToken = null;
    onUnauthorized?.();
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    if (res.ok) return undefined as T;
    throw new ApiError(res.status, { code: 'INTERNAL_ERROR', message: '伺服器回應格式錯誤' });
  }

  if (!res.ok) {
    const shape = (payload as { error?: ApiErrorShape }).error;
    throw new ApiError(
      res.status,
      shape ?? { code: 'INTERNAL_ERROR', message: '伺服器發生未預期的錯誤' },
    );
  }
  return (payload as ApiSuccessResponse<T>).data;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', ...(query ? { query } : {}), ...(signal ? { signal } : {}) }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ?? {} }),
  // query 是第六輪加的：`DELETE /api/trash?workspaceId=…`（清空垃圾桶）要用
  delete: <T>(path: string, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'DELETE', ...(query ? { query } : {}) }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', formData }),
  /** 下載二進位資料時用（帶 Authorization，不做 JSON 解析） */
  raw: (path: string) =>
    fetch(buildUrl(path), {
      credentials: 'include',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    }),
};
