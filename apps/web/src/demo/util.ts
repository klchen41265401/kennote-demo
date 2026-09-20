/**
 * Demo 後端的共用小工具。**零依賴**（除了 shared-types 的型別），
 * 所有函式都是純的，方便在 `__tests__/` 直接測。
 */
import type { RichText } from '@kennote/shared-types';

export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // jsdom / 舊瀏覽器退路
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 短碼（propertyId / view id 之類） */
export function shortId(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 8);
}

/* ── fractional index ────────────────────────────────────
 * 伺服器用的是自研 fractional index；demo 只要保證「同一個 parent 底下字典序
 * 穩定、可在任意兩個 key 之間插入」即可。
 */
const KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz';
const MIN_CHAR = KEY_ALPHABET[0]!;

/** 回傳一個字典序嚴格落在 (a, b) 之間的字串。a/b 為 null 代表開區間端點 */
export function sortKeyBetween(a: string | null, b: string | null): string {
  const lower = a ?? '';
  const upper = b ?? '';
  if (upper && lower && lower >= upper) return lower + 'm';
  let prefix = '';
  let i = 0;
  for (;;) {
    const lc = lower[i] ?? MIN_CHAR;
    const uc = upper[i] ?? undefined;
    if (uc !== undefined && lc === uc) {
      prefix += lc;
      i += 1;
      continue;
    }
    const lo = KEY_ALPHABET.indexOf(lc);
    const hi = uc === undefined ? KEY_ALPHABET.length : KEY_ALPHABET.indexOf(uc);
    if (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      return prefix + KEY_ALPHABET[mid]!;
    }
    // 沒有空隙 → 往下一層走
    prefix += lc;
    i += 1;
    if (i > 40) return prefix + 'm';
    if (uc === undefined && lower[i] === undefined) return prefix + 'm';
    if (uc !== undefined && lower[i] === undefined) {
      // upper 還有後續字元，lower 沒有 → 用 upper 的下一層往小的方向找
      const nextUpper = upper.slice(i);
      return prefix + sortKeyBetween(null, nextUpper);
    }
  }
}

/** 把一串 sortKey 重新排序（字典序，相同時用 id 決勝） */
export function bySortKey<T extends { sortKey: string; id: string }>(a: T, b: T): number {
  if (a.sortKey === b.sortKey) return a.id < b.id ? -1 : 1;
  return a.sortKey < b.sortKey ? -1 : 1;
}

/** 產生「排在最後面」的 key */
export function lastSortKey(existing: string[]): string {
  const max = existing.length > 0 ? existing.slice().sort().pop()! : null;
  return sortKeyBetween(max, null);
}

/* ── RichText ───────────────────────────────────────────── */

export function text(value: string): RichText {
  return value ? [{ text: value }] : [];
}

export function plain(rt: RichText | undefined | null): string {
  if (!Array.isArray(rt)) return '';
  return rt
    .map((span) => {
      const s = span as { text?: string; mention?: unknown; equation?: string };
      if (typeof s.text === 'string') return s.text;
      if (typeof s.equation === 'string') return s.equation;
      return '';
    })
    .join('');
}

/* ── children 陣列操作（與 server 的 validate-ops.ts 同語意）─ */

export function spliceChildren(
  children: string[],
  blockId: string,
  afterId: string | null,
): string[] {
  const next = children.filter((id) => id !== blockId);
  if (afterId === null) {
    next.unshift(blockId);
    return next;
  }
  const idx = next.indexOf(afterId);
  if (idx === -1) next.push(blockId);
  else next.splice(idx + 1, 0, blockId);
  return next;
}

export function removeChild(children: string[], blockId: string): string[] {
  return children.filter((id) => id !== blockId);
}

/* ── 回應形狀 ─────────────────────────────────────────── */

export interface ApiMeta {
  cursor?: string | null;
  total?: number;
  hasMore?: boolean;
}

export function jsonOk(data: unknown, meta?: ApiMeta, status = 200): Response {
  const body = meta ? { data, meta } : { data };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export class DemoApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DemoApiError';
  }
}

export function notFound(code = 'NOT_FOUND', message = '找不到資料'): DemoApiError {
  return new DemoApiError(404, code, message);
}

export function badRequest(message = '參數錯誤', code = 'BAD_REQUEST'): DemoApiError {
  return new DemoApiError(400, code, message);
}

export function jsonError(error: unknown): Response {
  if (error instanceof DemoApiError) {
    return new Response(
      JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      }),
      { status: error.status, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const message = error instanceof Error ? error.message : '未預期的錯誤';
  console.error('[demo] handler 失敗：', error);
  return new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message } }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 子字串比對（搜尋用）：大小寫不敏感，中文直接比 */
export function includesFold(haystack: string, needle: string): boolean {
  if (!needle) return true;
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}
