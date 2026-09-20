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
  sidebarPinnedTablet: 'kennote:sidebar-pinned-tablet',
  expanded: 'kennote:tree-expanded',
  sections: 'kennote:sidebar-sections',
  rightPanel: 'kennote:right-panel',
  rightPanelWidth: 'kennote:right-panel-width',
  lastPage: 'kennote:last-page',
} as const;

/**
 * 右側面板目前顯示的東西。
 *
 * gap-review B-6：`'inbox'` 是 dead type（`RightPanel` 從來沒有第三個 tab，
 * 傳進去會兩個 tab 都不 active、body 全空），這一輪拿掉。
 * 真實 Notion 7.34 的右側面板是「更新 / 分析」兩個 role=tab
 * （`reference/shots/gap-review/notion/_A3-updates.json`），
 * **版本紀錄是 ⋯ 選單裡另一個獨立項目**，不是同一個面板的 tab ——
 * 所以 `'history'` 在這裡代表「面板切成版本紀錄那個檢視」，不是一個 tab。
 */
export type RightPanelTab = 'comments' | 'updates' | 'analytics' | 'history';
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
  /**
   * 平板（768–1279）把側邊欄「釘住」成佔位欄（D-10）。
   * 未釘住時 768–1279 的側邊欄不佔位，但仍可用 hover 左緣浮出抽屜（與桌機收合態一樣）。
   */
  sidebarPinnedTablet: boolean;
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
  sidebarPinnedTablet: readBool(LS.sidebarPinnedTablet, false),
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

export function setSidebarPinnedTablet(pinned: boolean): void {
  uiStore.setState((s) => ({ ...s, sidebarPinnedTablet: pinned, sidebarPeek: false }));
  write(LS.sidebarPinnedTablet, pinned ? '1' : '0');
}

export function toggleSidebar(): void {
  const { sidebarCollapsed, mobileSidebarOpen, sidebarPinnedTablet } = uiStore.getState();
  const bp = currentBreakpoint();
  // 手機（<768）：覆蓋抽屜
  if (bp === 'mobile') {
    uiStore.setState((s) => ({ ...s, mobileSidebarOpen: !mobileSidebarOpen }));
    return;
  }
  // 平板（768–1279）：Ctrl+\ 切換「釘住成佔位欄」；沒釘住時一樣可以 hover 左緣浮出（D-10）
  if (bp === 'tablet') {
    setSidebarPinnedTablet(!sidebarPinnedTablet);
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

/**
 * D-1：「側邊欄要不要佔位」的門檻從 1280 降到 **768**。
 *
 * | 寬度 | 側邊欄 | 右側面板 | 內容欄 gutter |
 * |---|---|---|---|
 * | `< 768` `mobile` | 覆蓋抽屜 + 遮罩、底部固定工具列 | 覆蓋抽屜（幾乎滿版） | 16 |
 * | `768–1279` `tablet` | **佔位欄**（預設不釘住；`Ctrl+\` 釘住、hover 左緣浮出） | 覆蓋抽屜 | 48（768–1023）／72（1024–1279） |
 * | `≥ 1280` `desktop` | 佔位欄、預設展開 | **佔位欄**（推擠內容、可拖曳） | 96 |
 *
 * 原本 `tablet` 被當成「跟手機一樣的窄版」，1024 等於拿手機版面在用（gap-review D-1）。
 * 現在只有 `mobile` 才是窄版：`isNarrow()` ⇒ `<768`。
 */
export function currentBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  if (w < 768) return 'mobile';
  if (w < 1280) return 'tablet';
  return 'desktop';
}

/** 側邊欄是覆蓋抽屜（而不是佔位欄）嗎 —— 只有 `<768` 才是。 */
export function isNarrow(): boolean {
  return currentBreakpoint() === 'mobile';
}

/** 右側面板是否有「佔位欄」（`≥1280`）；否則是覆蓋抽屜。 */
export function hasRightPanelSlot(): boolean {
  return currentBreakpoint() === 'desktop';
}

/** 側邊欄目前是否佔位（桌機看 collapsed、平板看 pinned、手機一律不佔位）。 */
export function sidebarIsDocked(state: UiState = uiStore.getState(), bp = currentBreakpoint()): boolean {
  if (bp === 'mobile') return false;
  if (bp === 'tablet') return state.sidebarPinnedTablet;
  return !state.sidebarCollapsed;
}

/** 訂閱斷點（RWD：≥1280 桌機 / 768–1279 平板 / <768 手機） */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(currentBreakpoint);
  useEffect(() => {
    const onResize = (): void => setBp(currentBreakpoint());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return bp;
}

/**
 * D-7：把 `visualViewport`（軟鍵盤開合、行動瀏覽器網址列收合）的可視高度
 * 寫成 CSS 變數，shell 的抽屜 / 底部工具列 / bottom sheet 都吃這兩個值。
 *  - `--kn-vv-height`：可視高度
 *  - `--kn-vv-offset-bottom`：視窗底緣到可視區底緣的距離（= 鍵盤高度）
 *  - `--kn-keyboard-open`：1 / 0
 */
export function useVisualViewportVars(): boolean {
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const vv = typeof window === 'undefined' ? undefined : window.visualViewport;
    const root = document.documentElement;
    const apply = (): void => {
      const h = vv?.height ?? window.innerHeight;
      const bottom = Math.max(0, Math.round(window.innerHeight - h - (vv?.offsetTop ?? 0)));
      root.style.setProperty('--kn-vv-height', `${Math.round(h)}px`);
      root.style.setProperty('--kn-vv-offset-bottom', `${bottom}px`);
      const open = bottom > 120;
      root.style.setProperty('--kn-keyboard-open', open ? '1' : '0');
      setKeyboard(open);
    };
    apply();
    if (!vv) {
      window.addEventListener('resize', apply);
      return () => window.removeEventListener('resize', apply);
    }
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, []);
  return keyboard;
}
