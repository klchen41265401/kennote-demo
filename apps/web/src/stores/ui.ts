/**
 * App shell 的 UI 狀態（側邊欄寬度 / 收合、右側面板、浮層開關、樹的展開狀態）。
 *
 * 紀律：
 * - 只放「跟畫面有關、重新整理後可以重建」的狀態；資料一律走 lib/queries.ts 的快取。
 * - 會持久化的部分寫 localStorage（02 §4.2「展開狀態存本機」）。
 */
import { useEffect, useState } from 'react';
import { createStore, useStore } from '@kennote/ui';

const LS = {
  sidebarWidth: 'kennote:sidebar-width',
  sidebarCollapsed: 'kennote:sidebar-collapsed',
  expanded: 'kennote:tree-expanded',
  sections: 'kennote:sidebar-sections',
  rightPanel: 'kennote:right-panel',
  rightPanelWidth: 'kennote:right-panel-width',
  lastPage: 'kennote:last-page',
} as const;

export type RightPanelTab = 'comments' | 'history' | 'inbox';
export type OverlayName =
  | 'search'
  | 'quickSwitch'
  | 'settings'
  | 'shortcuts'
  | 'moveTo'
  | 'templates'
  | null;

export interface UiState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** 收合後滑到左緣時浮出的抽屜 */
  sidebarPeek: boolean;
  /** 平板 / 手機的覆蓋式抽屜 */
  mobileSidebarOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  rightPanelWidth: number;
  overlay: OverlayName;
  /** 「移動到」對話框的目標頁面 */
  moveTargetId: string | null;
  /** 設定 Dialog 目前的分頁 */
  settingsTab: string;
  /** 歷史版本預覽中的 seq（非 null 時整頁唯讀） */
  historyPreviewSeq: number | null;
}

function readNumber(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 無痕模式 */
  }
}

export const uiStore = createStore<UiState>({
  sidebarWidth: readNumber(LS.sidebarWidth, 270),
  sidebarCollapsed: readBool(LS.sidebarCollapsed, false),
  sidebarPeek: false,
  mobileSidebarOpen: false,
  rightPanelOpen: false,
  rightPanelTab: 'comments',
  rightPanelWidth: readNumber(LS.rightPanelWidth, 380),
  overlay: null,
  moveTargetId: null,
  settingsTab: 'account',
  historyPreviewSeq: null,
});

export function useUi(): UiState {
  return useStore(uiStore);
}

export function setSidebarWidth(width: number): void {
  const clamped = Math.min(420, Math.max(200, Math.round(width)));
  uiStore.setState((s) => (s.sidebarWidth === clamped ? s : { ...s, sidebarWidth: clamped }));
  write(LS.sidebarWidth, String(clamped));
}

export function setSidebarCollapsed(collapsed: boolean): void {
  uiStore.setState((s) => ({ ...s, sidebarCollapsed: collapsed, sidebarPeek: false }));
  write(LS.sidebarCollapsed, collapsed ? '1' : '0');
}

export function toggleSidebar(): void {
  const { sidebarCollapsed, mobileSidebarOpen } = uiStore.getState();
  if (isNarrow()) {
    uiStore.setState((s) => ({ ...s, mobileSidebarOpen: !mobileSidebarOpen }));
    return;
  }
  setSidebarCollapsed(!sidebarCollapsed);
}

export function setSidebarPeek(peek: boolean): void {
  uiStore.setState((s) => (s.sidebarPeek === peek ? s : { ...s, sidebarPeek: peek }));
}

export function setMobileSidebarOpen(open: boolean): void {
  uiStore.setState((s) => (s.mobileSidebarOpen === open ? s : { ...s, mobileSidebarOpen: open }));
}

export function setRightPanel(open: boolean, tab?: RightPanelTab): void {
  uiStore.setState((s) => ({ ...s, rightPanelOpen: open, rightPanelTab: tab ?? s.rightPanelTab }));
  write(LS.rightPanel, open ? '1' : '0');
}

export function toggleRightPanel(tab: RightPanelTab): void {
  const s = uiStore.getState();
  if (s.rightPanelOpen && s.rightPanelTab === tab) setRightPanel(false);
  else setRightPanel(true, tab);
}

export function setRightPanelWidth(width: number): void {
  const clamped = Math.min(520, Math.max(300, Math.round(width)));
  uiStore.setState((s) => (s.rightPanelWidth === clamped ? s : { ...s, rightPanelWidth: clamped }));
  write(LS.rightPanelWidth, String(clamped));
}

export function openOverlay(name: Exclude<OverlayName, null>, extra?: Partial<UiState>): void {
  uiStore.setState((s) => ({ ...s, ...extra, overlay: name }));
}

export function closeOverlay(): void {
  uiStore.setState((s) => (s.overlay === null ? s : { ...s, overlay: null, moveTargetId: null }));
}

export function setSettingsTab(tab: string): void {
  uiStore.setState((s) => ({ ...s, settingsTab: tab }));
}

export function setHistoryPreview(seq: number | null): void {
  uiStore.setState((s) => (s.historyPreviewSeq === seq ? s : { ...s, historyPreviewSeq: seq }));
}

/* ── 頁面樹展開狀態（localStorage，per workspace 不分開，id 本身就唯一）── */

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

export const expandedStore = createStore<ReadonlySet<string>>(readSet(LS.expanded));

export function useExpanded(): ReadonlySet<string> {
  return useStore(expandedStore);
}

export function setExpanded(id: string, open: boolean): void {
  expandedStore.setState((prev) => {
    if (prev.has(id) === open) return prev;
    const next = new Set(prev);
    if (open) next.add(id);
    else next.delete(id);
    write(LS.expanded, JSON.stringify([...next]));
    return next;
  });
}

export function toggleExpanded(id: string): void {
  setExpanded(id, !expandedStore.getState().has(id));
}

/** 展開某個頁面的整條祖先鏈（從搜尋跳頁時用） */
export function expandAncestors(ids: readonly string[]): void {
  if (ids.length === 0) return;
  expandedStore.setState((prev) => {
    const next = new Set(prev);
    let changed = false;
    for (const id of ids) {
      if (next.has(id)) continue;
      next.add(id);
      changed = true;
    }
    if (!changed) return prev;
    write(LS.expanded, JSON.stringify([...next]));
    return next;
  });
}

/* ── 分區收合（收藏 / 私人 / 共用）── */

export const sectionsStore = createStore<ReadonlySet<string>>(readSet(LS.sections));

export function useCollapsedSections(): ReadonlySet<string> {
  return useStore(sectionsStore);
}

export function toggleSection(id: string): void {
  sectionsStore.setState((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    write(LS.sections, JSON.stringify([...next]));
    return next;
  });
}

/* ── 上次造訪的頁面（登入後導回）── */

export function rememberLastPage(pageId: string): void {
  write(LS.lastPage, pageId);
}

export function getLastPage(): string | null {
  try {
    return localStorage.getItem(LS.lastPage);
  } catch {
    return null;
  }
}

/* ── 斷點 ── */

export type Breakpoint = 'desktop' | 'tablet' | 'mobile';

export function currentBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  if (w < 768) return 'mobile';
  if (w < 1280) return 'tablet';
  return 'desktop';
}

export function isNarrow(): boolean {
  return currentBreakpoint() !== 'desktop';
}

/** 訂閱斷點（RWD：≥1280 桌機 / 768–1279 平板 / <768 手機） */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(currentBreakpoint);
  useEffect(() => {
    const onResize = (): void => setBp(currentBreakpoint());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return bp;
}
