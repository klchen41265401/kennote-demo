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
/**
 * token 的世代編號。每次 access token 換新就 +1。
 *
 * 用途：一個請求可能在**還沒有 token**（開機 bootstrap 還沒回來）時就送出去，
 * 回來必然是 401。這時候如果傻傻地再打一次 /refresh，就會跟 bootstrap 那一次
 * 撞在一起 —— 後端的 refresh token 是**一次性輪替 + 重用偵測**，
 * 併發的第二次會被判定成 token reuse，**整個 session 家族被撤銷**（使用者直接被登出）。
 * 所以 401 回來時先比對世代：期間已經換到新 token 了就「直接重送」，不要再 refresh。
 */
let tokenVersion = 0;

export function setAccessToken(token: string | null): void {
  accessToken = token;
  tokenVersion += 1;
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/**
 * 全 App **唯一**一條打 /api/auth/refresh 的路徑（開機 bootstrap 也走這裡）。
 *
 * ⚠️ 一定要共用同一個 in-flight promise：後端 `modules/auth/token-state.ts` 會把
 * 「已經輪替過的 refresh token 又被用一次」當成重用攻擊，直接 `revokeFamily`。
 * 換句話說，**同時**打兩次 /refresh 的下場是整個 session 被撤銷、使用者被踢回登入頁
 * （這正是 side peek 冷啟動 `?p=` 會掉登入的原因：`PeekHost` 在 bootstrap 還沒回來時
 * 就先發了 `GET /api/pages/:id`，401 之後又自己去 refresh 一次）。
 *
 * 回傳 server 的 session payload（`null` = 失敗）。呼叫端自行判型。
 */
let refreshPromise: Promise<unknown> | null = null;

export function refreshSession(): Promise<unknown> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) return null;
        const body = (await res.json()) as ApiSuccessResponse<{ accessToken: string }>;
        setAccessToken(body.data.accessToken);
        return body.data;
      } catch {
        return null;
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

async function refreshAccessToken(): Promise<boolean> {
  return (await refreshSession()) !== null;
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

  // 送出當下的 token 世代：401 回來時用來分辨「token 真的過期」與
  // 「這個請求本來就是在沒有 token / 舊 token 的時候送出去的」
  const sentVersion = tokenVersion;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), init);
  } catch {
    throw new ApiError(0, { code: 'INTERNAL_ERROR', message: '連線失敗，請檢查網路' });
  }

  // 401 → 自動 refresh 一次，成功就重試原請求
  if (res.status === 401 && !options.skipRefresh) {
    // 期間已經換到新 token（通常是開機 bootstrap 的 /refresh 剛回來）→
    // 直接用新 token 重送，**不要**再打一次 /refresh（會被判定成 token reuse）
    if (tokenVersion !== sentVersion) {
      return request<T>(path, { ...options, skipRefresh: true });
    }
    const ok = await refreshAccessToken();
    if (ok) return request<T>(path, { ...options, skipRefresh: true });
    setAccessToken(null);
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
