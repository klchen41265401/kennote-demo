/**
 * Demo 模式（純瀏覽器後端）的安裝入口。
 *
 * `VITE_DEMO=1` 時由 `main.tsx` 在**最早期**呼叫 `installDemoBackend()`：
 *
 *   1. 攔截 `globalThis.fetch` 對 `/api/**` 的請求 → `demo/router.ts`
 *   2. 攔截 `XMLHttpRequest` 對 `/api/**` 的請求（`lib/upload.ts` 用 XHR 才有進度條）
 *   3. 用假的 `globalThis.WebSocket` 接上 `/ws`（presence / 連線徽章正常）
 *   4. 第一次載入時種一份示範資料（IndexedDB 持久化）
 *
 * 沒有伺服器、沒有網路請求 —— GitHub Pages 這種純靜態主機就能跑完整站。
 */
import { dispatch, listRoutes, registerRoutes } from './router';
import { blobUrlFor, store } from './store';
import { installDemoWebSocket } from './ws';
import { seedDemoData } from './seed';
import { authRoutes, ensureDemoUser } from './handlers/auth';
import { pageRoutes, trashRoutes, workspaceRoutes } from './handlers/pages';
import { databaseRoutes } from './handlers/databases';
import {
  commentRoutes,
  exportRoutes,
  fileRoutes,
  importRoutes,
  notificationRoutes,
  permissionRoutes,
  searchRoutes,
  systemRoutes,
} from './handlers/misc';

export const DEMO_MODE = import.meta.env.VITE_DEMO === '1';

let installed = false;
let readyPromise: Promise<void> | null = null;

function registerAll(): void {
  registerRoutes(systemRoutes);
  registerRoutes(authRoutes);
  registerRoutes(workspaceRoutes);
  // pageRoutes 的字面路徑（favorites / recent / shared-with-me）必須排在 :id 之前，
  // 而 permission / comment / export 是 /api/pages/:id/* 的延伸，放後面就好。
  registerRoutes(pageRoutes);
  registerRoutes(permissionRoutes);
  registerRoutes(commentRoutes);
  registerRoutes(exportRoutes);
  registerRoutes(trashRoutes);
  registerRoutes(databaseRoutes);
  registerRoutes(searchRoutes);
  registerRoutes(fileRoutes);
  registerRoutes(notificationRoutes);
  registerRoutes(importRoutes);
}

function isApiPath(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl, globalThis.location?.href ?? 'http://localhost/');
    return url.pathname.startsWith('/api/');
  } catch {
    return rawUrl.startsWith('/api/');
  }
}

function patchFetch(): void {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isApiPath(rawUrl)) return original(input as RequestInfo, init);
    await ready();
    const request = input instanceof Request && !init ? input : new Request(rawUrl, init);
    const res = await dispatch(request);
    return (
      res ??
      new Response(
        JSON.stringify({ error: { code: 'NOT_IMPLEMENTED', message: `Demo 模式未實作：${rawUrl}` } }),
        { status: 501, headers: { 'Content-Type': 'application/json' } },
      )
    );
  };
}

/**
 * XHR 攔截。`lib/upload.ts` 用 XMLHttpRequest 才拿得到上傳進度，
 * 只 patch `fetch` 的話「上傳圖片」會直接打到不存在的伺服器。
 */
function patchXhr(): void {
  const XHR = globalThis.XMLHttpRequest;
  if (!XHR) return;
  const open = XHR.prototype.open;
  const send = XHR.prototype.send;

  interface DemoXhr extends XMLHttpRequest {
    __demoUrl?: string;
    __demoMethod?: string;
    __demoHeaders?: Record<string, string>;
  }

  XHR.prototype.open = function patchedOpen(
    this: DemoXhr,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const raw = String(url);
    if (isApiPath(raw)) {
      this.__demoUrl = raw;
      this.__demoMethod = method;
      this.__demoHeaders = {};
      return;
    }
    return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XHR.prototype.open;

  const setRequestHeader = XHR.prototype.setRequestHeader;
  XHR.prototype.setRequestHeader = function patchedSetHeader(this: DemoXhr, name: string, value: string) {
    if (this.__demoUrl) {
      this.__demoHeaders![name] = value;
      return;
    }
    return setRequestHeader.call(this, name, value);
  };

  XHR.prototype.send = function patchedSend(this: DemoXhr, body?: Document | XMLHttpRequestBodyInit | null) {
    if (!this.__demoUrl) return (send as (...args: unknown[]) => void).call(this, body);
    const self = this as DemoXhr & {
      readyState: number;
      status: number;
      responseText: string;
      response: unknown;
      onload: ((ev?: unknown) => void) | null;
      onerror: ((ev?: unknown) => void) | null;
    };
    void (async () => {
      await ready();
      try {
        const request = new Request(this.__demoUrl!, {
          method: this.__demoMethod ?? 'GET',
          headers: this.__demoHeaders,
          ...(body != null && this.__demoMethod !== 'GET'
            ? { body: body as XMLHttpRequestBodyInit }
            : {}),
        });
        const res = (await dispatch(request)) ?? new Response('{}', { status: 501 });
        const textBody = await res.text();
        Object.defineProperty(self, 'status', { value: res.status, configurable: true });
        Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
        Object.defineProperty(self, 'responseText', { value: textBody, configurable: true });
        Object.defineProperty(self, 'response', { value: textBody, configurable: true });
        // 上傳進度：demo 是瞬間完成，直接回報 100%
        const upload = self.upload as unknown as { dispatchEvent?: (ev: Event) => boolean } | undefined;
        if (upload?.dispatchEvent) {
          const ev = new ProgressEvent('progress', { lengthComputable: true, loaded: 1, total: 1 });
          upload.dispatchEvent(ev);
        }
        self.dispatchEvent(new Event('readystatechange'));
        self.dispatchEvent(new Event('load'));
        self.onload?.();
      } catch {
        self.dispatchEvent(new Event('error'));
        self.onerror?.();
      }
    })();
  } as typeof XHR.prototype.send;
}

function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await store.init();
      ensureDemoUser();
      if (!store.state.seededAt) seedDemoData();
      // 重新整理之後仍然是登入狀態（demo 沒有 refresh cookie 的概念）
      store.state.sessionUserId = store.state.sessionUserId ?? ensureDemoUser().id;
    })();
  }
  return readyPromise;
}

/** 設定頁的「重設 Demo 資料」 */
export async function resetDemoData(): Promise<void> {
  await store.reset();
  readyPromise = null;
  await ready();
}

/** 安裝 demo 後端。重複呼叫是安全的。 */
export function installDemoBackend(): void {
  if (installed || !DEMO_MODE) return;
  installed = true;
  registerAll();
  patchFetch();
  patchXhr();
  installDemoWebSocket();
  // `lib/upload.ts` 的 resolveMediaUrl() 會先問這個掛勾：
  // demo 沒有 /api/files/:id 這種「瀏覽器自己去載」的路徑（<img src> 不走 fetch），
  // 所以直接把 fileId 換成 IndexedDB 的 blob: URL。
  (globalThis as unknown as { __KENNOTE_DEMO_FILE_URL__?: (id: string) => string | null }).
    __KENNOTE_DEMO_FILE_URL__ = (id: string) => blobUrlFor(id);
  // 先把資料準備好（不 await：第一個 API 請求會等 ready()）
  void ready();
}

export { listRoutes, ready as demoReady };
