/**
 * SelectionManager：model selection 與 DOM selection 的唯一接點。
 *
 * 鐵則（04 §4.3）：任何會改動 DOM 的操作都必須「存 → 改 → 還原」三步走。
 *  - read()     ：從 DOM 讀出 model selection
 *  - write()    ：把 model selection 寫回 DOM（期間 suppress，不讓 selectionchange 回饋進來）
 *  - suppress   ：自己造成的 selectionchange 一律忽略
 *  - IME 期間   ：selectionchange 一律不處理，否則候選字視窗會錯位
 *  - 節流       ：selectionchange 觸發極頻繁，用 rAF 節流，避免浮動工具列抖動
 */
import type { EditorSelection } from './types.js';
import { NO_SELECTION, selectionEquals } from './types.js';
import { closestBlock, domToModel, getContentEl, modelToDom, BLOCK_ID_ATTR } from './dom-mapper.js';
import { getSelectionRect } from './caret.js';

export interface BlockElementProvider {
  /** 取得 block 的外層容器（帶 data-block-id）。 */
  getBlockEl(blockId: string): HTMLElement | null;
  /** 取得 block 的可編輯內容元素。 */
  getContentEl(blockId: string): HTMLElement | null;
}

export interface SelectionManagerOptions {
  root: HTMLElement;
  view: BlockElementProvider;
  /** IME 組字中回傳 true；組字期間 selectionchange 一律忽略。 */
  isComposing(): boolean;
  onChange(sel: EditorSelection): void;
}

export class SelectionManager {
  private readonly root: HTMLElement;
  private readonly view: BlockElementProvider;
  private readonly isComposing: () => boolean;
  private readonly onChange: (sel: EditorSelection) => void;
  private readonly doc: Document;
  private readonly win: Window;

  private suppressDepth = 0;
  private rafHandle: number | null = null;
  private current: EditorSelection = NO_SELECTION;
  private detached = false;

  constructor(options: SelectionManagerOptions) {
    this.root = options.root;
    this.view = options.view;
    this.isComposing = options.isComposing;
    this.onChange = options.onChange;
    this.doc = options.root.ownerDocument;
    this.win = this.doc.defaultView ?? (globalThis as unknown as Window);
    this.doc.addEventListener('selectionchange', this.handleSelectionChange);
  }

  destroy(): void {
    this.detached = true;
    this.doc.removeEventListener('selectionchange', this.handleSelectionChange);
    if (this.rafHandle !== null) {
      this.win.cancelAnimationFrame?.(this.rafHandle);
      this.rafHandle = null;
    }
  }

  get value(): EditorSelection {
    return this.current;
  }

  /** 我們自己在改 DOM/selection 時，把 selectionchange 的回饋關掉。 */
  suppress<T>(fn: () => T): T {
    this.suppressDepth++;
    try {
      return fn();
    } finally {
      // 同一輪 task 內觸發的 selectionchange 是非同步派發的，所以要延到 microtask 之後才解除
      const release = () => {
        this.suppressDepth = Math.max(0, this.suppressDepth - 1);
      };
      queueMicrotask(release);
    }
  }

  get isSuppressed(): boolean {
    return this.suppressDepth > 0;
  }

  /** 直接設定 model selection（不碰 DOM），用於 block selection 模式。 */
  setModel(sel: EditorSelection, options?: { silent?: boolean }): void {
    const changed = !selectionEquals(this.current, sel);
    this.current = sel;
    if (changed && !options?.silent) this.onChange(sel);
  }

  /** 從 DOM 讀出目前的 model selection。 */
  read(): EditorSelection {
    const sel = this.doc.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return NO_SELECTION;
    const anchorBlock = closestBlock(sel.anchorNode);
    const focusBlock = closestBlock(sel.focusNode ?? sel.anchorNode);
    if (!anchorBlock || !focusBlock) return NO_SELECTION;
    if (!this.root.contains(anchorBlock)) return NO_SELECTION;

    const anchorId = anchorBlock.getAttribute(BLOCK_ID_ATTR);
    const focusId = focusBlock.getAttribute(BLOCK_ID_ATTR);
    if (!anchorId || !focusId) return NO_SELECTION;

    // 跨 block 的原生選取 → 交給 block selection 模式處理（由 block-selection.ts 接手）
    if (anchorId !== focusId) {
      return { type: 'text', anchor: { blockId: anchorId, offset: 0 }, focus: { blockId: focusId, offset: 0 } };
    }

    const contentEl = getContentEl(anchorBlock);
    if (!contentEl) return NO_SELECTION;
    return {
      type: 'text',
      anchor: { blockId: anchorId, offset: domToModel(contentEl, sel.anchorNode, sel.anchorOffset) },
      focus: { blockId: focusId, offset: domToModel(contentEl, sel.focusNode ?? sel.anchorNode, sel.focusOffset) },
    };
  }

  /** 把 model selection 寫回 DOM。 */
  write(ms: EditorSelection, options?: { silent?: boolean }): void {
    this.current = ms;
    const sel = this.doc.getSelection();
    if (!sel) return;

    if (ms.type !== 'text') {
      this.suppress(() => {
        sel.removeAllRanges();
        const active = this.doc.activeElement;
        if (active instanceof HTMLElement && this.root.contains(active)) active.blur();
      });
      if (!options?.silent) this.onChange(ms);
      return;
    }

    const contentEl = this.view.getContentEl(ms.focus.blockId) ?? this.view.getContentEl(ms.anchor.blockId);
    if (!contentEl) return;

    this.suppress(() => {
      const sameBlock = ms.anchor.blockId === ms.focus.blockId;
      const anchorEl = sameBlock ? contentEl : this.view.getContentEl(ms.anchor.blockId) ?? contentEl;
      const a = modelToDom(anchorEl, ms.anchor.offset);
      const f = modelToDom(contentEl, ms.focus.offset);
      // 必須先 focus 該 block，否則某些瀏覽器不接受 setBaseAndExtent
      contentEl.focus({ preventScroll: true });
      try {
        sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
      } catch {
        // 目標節點可能剛被重繪替換掉；退一步只設 collapsed 游標
        try {
          const range = this.doc.createRange();
          range.setStart(f.node, f.offset);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch {
          /* 放棄，等下一次 selectionchange */
        }
      }
    });
    if (!options?.silent) this.onChange(ms);
  }

  /** 供浮動工具列定位。 */
  getSelectionRect(): DOMRect | null {
    return getSelectionRect(this.doc);
  }

  /** 取得目前 caret 的 Range（goalX / 首末行判斷用）。 */
  getCurrentRange(): Range | null {
    const sel = this.doc.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return sel.getRangeAt(0);
  }

  /** 強制重新讀一次並廣播（例如 applyTransaction 之後）。 */
  refresh(): void {
    const next = this.read();
    if (!selectionEquals(this.current, next)) {
      this.current = next;
      this.onChange(next);
    }
  }

  private handleSelectionChange = (): void => {
    if (this.detached) return;
    if (this.suppressDepth > 0) return;
    if (this.isComposing()) return; // IME 組字期間絕不處理
    if (this.rafHandle !== null) return;
    const schedule = this.win.requestAnimationFrame?.bind(this.win) ?? ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
    this.rafHandle = schedule(() => {
      this.rafHandle = null;
      if (this.detached || this.suppressDepth > 0 || this.isComposing()) return;
      const next = this.read();
      if (next.type === 'none' && this.current.type === 'block') return; // 保留自訂的 block 選取
      if (selectionEquals(this.current, next)) return;
      this.current = next;
      this.onChange(next);
    }) as unknown as number;
  };
}
