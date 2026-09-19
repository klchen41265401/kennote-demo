/**
 * 浮層堆疊管理（02-UI架構 §2.6 + §4.7.2）。
 * 純 TypeScript 單例，框架無關；React 層以 useSyncExternalStore 訂閱。
 *
 * 全域 keydown / pointerdown 只在這裡註冊一次，
 * 各浮層元件**不得**自行綁 document 事件。
 */

export type OverlayLevel = 'dropdown' | 'toolbar' | 'modal' | 'toast' | 'tooltip';

/** §2.6 浮層層級表。tokens.css 若有同名變數以 CSS 為準，這裡是 JS 端的鏡像。 */
export const OVERLAY_Z_INDEX: Record<OverlayLevel, number> = {
  dropdown: 300,
  toolbar: 400,
  modal: 500,
  toast: 600,
  tooltip: 700,
};

export interface OverlayEntryInit {
  level: OverlayLevel;
  closeOnOutside: boolean;
  closeOnEsc: boolean;
  trapFocus: boolean;
  lockScroll: boolean;
  /** 觸發浮層的錨點：點在它上面不算「外部」，否則開啟按鈕會立刻關掉浮層。 */
  getAnchor?: () => Element | null | undefined;
  onClose: () => void;
}

export interface OverlayEntry extends OverlayEntryInit {
  id: string;
  /** 浮層根元素，由 React 層在掛載後回填。 */
  element: HTMLElement | null;
  /** 開啟前的焦點元素，關閉時還原。 */
  returnFocusTo: HTMLElement | null;
}

let counter = 0;
const uid = (): string => `kn-overlay-${++counter}`;

type Listener = () => void;

class OverlayStackImpl {
  private entries: OverlayEntry[] = [];
  private listeners = new Set<Listener>();
  private snapshot: readonly OverlayEntry[] = [];
  private globalsBound = false;
  private scrollLocks = 0;
  private previousBodyOverflow: string | null = null;
  private previousBodyPaddingRight: string | null = null;

  open(init: OverlayEntryInit): string {
    this.bindGlobals();
    const id = uid();
    const active =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const entry: OverlayEntry = { ...init, id, element: null, returnFocusTo: active };
    this.entries.push(entry);
    if (entry.lockScroll) this.lockScroll();
    this.notify();
    return id;
  }

  /** React 層掛載後回填浮層根元素（外部點擊判定需要）。 */
  setElement(id: string, element: HTMLElement | null): void {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) entry.element = element;
  }

  close(id: string): void {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return;
    // 關閉某一層時，其上的所有層一併關閉（避免孤兒浮層）。
    const removed = this.entries.splice(idx);
    for (const entry of removed.reverse()) {
      if (entry.lockScroll) this.unlockScroll();
      entry.onClose();
      if (entry.trapFocus) this.restoreFocus(entry);
    }
    this.notify();
  }

  /** 只是把 entry 從堆疊移除（元件自行卸載時用），不呼叫 onClose。 */
  remove(id: string): void {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const [entry] = this.entries.splice(idx, 1);
    if (entry?.lockScroll) this.unlockScroll();
    this.notify();
  }

  closeTop(): boolean {
    const top = this.entries.at(-1);
    if (!top) return false;
    if (!top.closeOnEsc) return false;
    this.close(top.id);
    return true;
  }

  get top(): OverlayEntry | null {
    return this.entries.at(-1) ?? null;
  }

  isTop(id: string): boolean {
    return this.entries.at(-1)?.id === id;
  }

  indexOf(id: string): number {
    return this.entries.findIndex((e) => e.id === id);
  }

  getSnapshot = (): readonly OverlayEntry[] => this.snapshot;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /** 給測試用：清空堆疊與捲動鎖。 */
  reset(): void {
    this.entries = [];
    this.scrollLocks = 0;
    this.restoreBodyStyle();
    this.notify();
  }

  // ── 外部點擊判定（含巢狀浮層）──────────────────────────────

  /**
   * 找出「包含 target 的最上層浮層」，關閉它之上、且允許外部關閉的所有層。
   * 這樣點父選單時只關子選單，點完全外部時才整串關掉。
   */
  handleOutsidePointer(target: Node | null): void {
    if (this.entries.length === 0) return;
    let insideIdx = -1;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (!entry) continue;
      if (this.entryContains(entry, target)) {
        insideIdx = i;
        break;
      }
    }
    let cutoff = this.entries.length;
    for (let i = this.entries.length - 1; i > insideIdx; i--) {
      const entry = this.entries[i];
      if (!entry?.closeOnOutside) break;
      cutoff = i;
    }
    const victim = this.entries[cutoff];
    if (victim) this.close(victim.id);
  }

  private entryContains(entry: OverlayEntry, target: Node | null): boolean {
    if (!target) return false;
    if (entry.element?.contains(target)) return true;
    const anchor = entry.getAnchor?.();
    if (anchor && anchor.contains(target)) return true;
    return false;
  }

  // ── 全域事件（只註冊一次）──────────────────────────────────

  private bindGlobals(): void {
    if (this.globalsBound || typeof document === 'undefined') return;
    this.globalsBound = true;
    // capture 階段，確保先於編輯器的鍵盤處理。
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        if (this.closeTop()) {
          e.preventDefault();
          e.stopPropagation();
        }
      },
      true,
    );
    // 用 pointerdown 而非 click：click 會讓「開啟按鈕」的事件冒泡回 document，
    // 導致浮層開啟後立刻被關掉（§4.7.2）。
    document.addEventListener(
      'pointerdown',
      (e) => {
        this.handleOutsidePointer(e.target as Node | null);
      },
      true,
    );
  }

  // ── 捲動鎖 ────────────────────────────────────────────────

  private lockScroll(): void {
    if (typeof document === 'undefined') return;
    this.scrollLocks += 1;
    if (this.scrollLocks > 1) return;
    const body = document.body;
    this.previousBodyOverflow = body.style.overflow;
    this.previousBodyPaddingRight = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) {
      const current = parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + scrollbar}px`;
    }
  }

  private unlockScroll(): void {
    if (this.scrollLocks === 0) return;
    this.scrollLocks -= 1;
    if (this.scrollLocks === 0) this.restoreBodyStyle();
  }

  private restoreBodyStyle(): void {
    if (typeof document === 'undefined') return;
    const body = document.body;
    if (this.previousBodyOverflow !== null) body.style.overflow = this.previousBodyOverflow;
    if (this.previousBodyPaddingRight !== null) {
      body.style.paddingRight = this.previousBodyPaddingRight;
    }
    this.previousBodyOverflow = null;
    this.previousBodyPaddingRight = null;
  }

  // ── 焦點還原 ──────────────────────────────────────────────

  private restoreFocus(entry: OverlayEntry): void {
    const el = entry.returnFocusTo;
    if (typeof document === 'undefined') return;
    // 觸發元素可能已被移除（例如右鍵選單選了「刪除」）。
    if (el && document.contains(el) && typeof el.focus === 'function') {
      el.focus({ preventScroll: true });
    } else {
      document.body.focus?.({ preventScroll: true });
    }
  }

  private notify(): void {
    this.snapshot = [...this.entries];
    for (const fn of this.listeners) fn();
  }
}

export type OverlayStack = OverlayStackImpl;

/** 全應用唯一的浮層堆疊。 */
export const overlayStack: OverlayStackImpl = new OverlayStackImpl();

export function overlayZIndex(level: OverlayLevel): number {
  return OVERLAY_Z_INDEX[level];
}
