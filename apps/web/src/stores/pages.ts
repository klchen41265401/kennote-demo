/**
 * 頁面層級的本機狀態：版面（標準 / 寬版 / 小字）與瀏覽歷史。
 *
 * 為什麼存 localStorage：`PATCH /api/pages/:id` 目前只收 title / icon / cover，
 * 沒有 `props.layout` 欄位（packages/shared-types 的 PatchPageRequest）。
 * 加欄位要動 migration 與後端契約，跨代理成本太高；
 * 等後端補上之後把 `usePageLayout` 的讀寫換成 `page.props` 即可，呼叫端一行都不用改。
 */
import { useCallback, useEffect, useState } from 'react';
import { createStore, useStore } from '@kennote/ui';

export interface PageLayout {
  /** 全寬（Notion 的「全寬」開關） */
  fullWidth: boolean;
  /** 小字型 */
  smallText: boolean;
  /** 字型：預設 / 襯線 / 等寬 */
  font: 'default' | 'serif' | 'mono';
  /** 鎖定頁面（唯讀） */
  locked: boolean;
}

export const DEFAULT_LAYOUT: PageLayout = {
  fullWidth: false,
  smallText: false,
  font: 'default',
  locked: false,
};

const KEY = 'kennote:page-layout';

function readAll(): Record<string, PageLayout> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, PageLayout>) : {};
  } catch {
    return {};
  }
}

export const layoutStore = createStore<Record<string, PageLayout>>(readAll());

export function setPageLayout(pageId: string, patch: Partial<PageLayout>): void {
  layoutStore.setState((prev) => {
    const next = { ...prev, [pageId]: { ...DEFAULT_LAYOUT, ...prev[pageId], ...patch } };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 無痕模式 */
    }
    return next;
  });
}

export function usePageLayout(pageId: string | null): PageLayout {
  const all = useStore(layoutStore);
  return (pageId ? all[pageId] : undefined) ?? DEFAULT_LAYOUT;
}

/* ── 瀏覽歷史（Ctrl+[ / Ctrl+]）────────────────────────────
   react-router 的 history 已經支援 back/forward，這裡只是記錄
   「最近造訪的頁面 id」供首頁與快速切換器排序用。 */

const RECENT_KEY = 'kennote:recent-visits';
const MAX_RECENT = 20;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export const recentVisitsStore = createStore<readonly string[]>(readRecent());

export function recordVisit(pageId: string): void {
  recentVisitsStore.setState((prev) => {
    if (prev[0] === pageId) return prev;
    const next = [pageId, ...prev.filter((id) => id !== pageId)].slice(0, MAX_RECENT);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* 無痕模式 */
    }
    return next;
  });
}

export function useRecentVisits(): readonly string[] {
  return useStore(recentVisitsStore);
}

/** 相對時間（zh-TW）：「剛剛 / X 分鐘前 / X 小時前 / X 天前 / 日期」 */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '剛剛';
  if (min < 60) return `${min} 分鐘前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小時前`;
  const day = Math.floor(hour / 24);
  if (day === 1) return '昨天';
  if (day < 7) return `${day} 天前`;
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? `${d.getMonth() + 1} 月 ${d.getDate()} 日`
    : `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/** 「已於 X 分鐘前 編輯」（空格照 Notion topbar 的排版，04b-topbar-right-*.png） */
export function editedLabel(iso: string | null | undefined, now = Date.now()): string {
  const rel = relativeTime(iso, now);
  if (!rel) return '';
  return rel === '剛剛' ? '剛剛編輯' : `已於 ${rel} 編輯`;
}

/** 首頁問候語 */
export function greeting(name: string, hour = new Date().getHours()): string {
  const part = hour < 5 ? '晚安' : hour < 12 ? '早安' : hour < 18 ? '午安' : '晚安';
  return name ? `${part}，${name}` : part;
}

/** hooks 友善的「現在」：每 60 秒更新一次，讓相對時間會自己走 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 方便在事件處理器裡取得穩定的 setter */
export function useLayoutSetter(pageId: string | null): (patch: Partial<PageLayout>) => void {
  return useCallback(
    (patch: Partial<PageLayout>) => {
      if (pageId) setPageLayout(pageId, patch);
    },
    [pageId],
  );
}
