/**
 * 極小的路徑比對器：`METHOD /api/pages/:id/snapshot` → handler。
 *
 * 只比對 `URL.pathname`（前端一律用 `/api/...` 絕對路徑打 fetch，
 * 不受 `import.meta.env.BASE_URL` 子路徑影響）。
 */
import { DemoApiError, jsonError, notFound } from './util';

export interface DemoRequest {
  method: string;
  /** 路徑參數（`:id` → params.id） */
  params: Record<string, string>;
  query: URLSearchParams;
  url: URL;
  request: Request;
  /** JSON body（沒有 body 時為 undefined） */
  json<T = unknown>(): Promise<T | undefined>;
  formData(): Promise<FormData>;
}

export type DemoHandler = (req: DemoRequest) => Promise<Response> | Response;

interface Route {
  method: string;
  segments: string[];
  handler: DemoHandler;
}

const routes: Route[] = [];

/** 註冊一條路由。`pattern` 例：`GET /api/pages/:id/snapshot` */
export function route(pattern: string, handler: DemoHandler): void {
  const space = pattern.indexOf(' ');
  const method = pattern.slice(0, space).toUpperCase();
  const path = pattern.slice(space + 1);
  routes.push({ method, segments: path.split('/').filter(Boolean), handler });
}

export function registerRoutes(list: Array<[string, DemoHandler]>): void {
  for (const [pattern, handler] of list) route(pattern, handler);
}

function match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter(Boolean);
  let methodMatchedPath = false;
  for (const r of routes) {
    if (r.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < r.segments.length; i += 1) {
      const seg = r.segments[i]!;
      const part = parts[i]!;
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = decodeURIComponent(part);
        continue;
      }
      if (seg !== part) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    methodMatchedPath = true;
    if (r.method !== method) continue;
    return { route: r, params };
  }
  if (methodMatchedPath) {
    throw new DemoApiError(405, 'BAD_REQUEST', `Demo 後端不支援 ${method} ${pathname}`);
  }
  return null;
}

/** 已註冊的端點清單（README / 測試用） */
export function listRoutes(): string[] {
  return routes.map((r) => `${r.method} /${r.segments.join('/')}`).sort();
}

/**
 * 處理一個請求。沒有對應的 handler → 回 null（由 installDemoBackend 決定要不要 404）。
 */
export async function dispatch(request: Request): Promise<Response | null> {
  const url = new URL(request.url, globalThis.location?.origin ?? 'http://localhost');
  let found: { route: Route; params: Record<string, string> } | null;
  try {
    found = match(request.method.toUpperCase(), url.pathname);
  } catch (error) {
    return jsonError(error);
  }
  if (!found) return null;

  let bodyText: string | null = null;
  const req: DemoRequest = {
    method: request.method.toUpperCase(),
    params: found.params,
    query: url.searchParams,
    url,
    request,
    async json<T>(): Promise<T | undefined> {
      if (bodyText === null) {
        try {
          bodyText = await request.clone().text();
        } catch {
          bodyText = '';
        }
      }
      if (!bodyText) return undefined;
      try {
        return JSON.parse(bodyText) as T;
      } catch {
        return undefined;
      }
    },
    formData: () => request.clone().formData(),
  };

  try {
    return await found.route.handler(req);
  } catch (error) {
    return jsonError(error);
  }
}

export { notFound };
