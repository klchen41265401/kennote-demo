/**
 * 跨 block 的整塊選取（04 §4.1 路線 C）。
 *
 * 關鍵產品決策：跨 block 拖選時不做精細的部分文字選取，而是把涉及的 block 整塊反白。
 * 這個決策換掉了「跨 contenteditable root 的精細選取」這個最難的工程問題。
 */
import type { EditorDoc } from '../model/types.js';
import { blockRange } from '../model/document.js';
import type { EditorSelection } from './types.js';
import { blockSelection } from './types.js';
import { BLOCK_ID_ATTR, closestBlock } from './dom-mapper.js';

export const SELECTED_ATTR = 'data-selected';

export interface BlockSelectionHost {
  root: HTMLElement;
  getDoc(): EditorDoc;
  getSelection(): EditorSelection;
  setSelection(sel: EditorSelection): void;
  /** 進入 block 模式時，把原生 selection 清掉。 */
  clearNativeSelection(): void;
}

/** 從螢幕座標找出所在的 block id。 */
export function findBlockIdFromPoint(doc: Document, x: number, y: number): string | null {
  // jsdom 沒有實作 elementFromPoint；沒有幾何資訊時就當作「沒有跨越 block」
  if (typeof doc.elementFromPoint !== 'function') return null;
  const el = doc.elementFromPoint(x, y);
  const blockEl = closestBlock(el);
  return blockEl?.getAttribute(BLOCK_ID_ATTR) ?? null;
}

/**
 * 指標拖曳期間的 block selection 偵測。
 * pointerdown 記下起點 block；pointermove 若跨越了 block 邊界就切到 block 模式。
 */
export class BlockSelectionController {
  private readonly host: BlockSelectionHost;
  private readonly doc: Document;
  private dragAnchorId: string | null = null;
  private mode: 'text' | 'block' = 'text';
  private pointerActive = false;

  constructor(host: BlockSelectionHost) {
    this.host = host;
    this.doc = host.root.ownerDocument;
  }

  attach(): void {
    this.host.root.addEventListener('pointerdown', this.onPointerDown);
    this.doc.addEventListener('pointermove', this.onPointerMove);
    this.doc.addEventListener('pointerup', this.onPointerUp);
  }

  detach(): void {
    this.host.root.removeEventListener('pointerdown', this.onPointerDown);
    this.doc.removeEventListener('pointermove', this.onPointerMove);
    this.doc.removeEventListener('pointerup', this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.pointerActive = true;
    this.mode = 'text';
    this.dragAnchorId = findBlockIdFromPoint(this.doc, e.clientX, e.clientY);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.pointerActive || !this.dragAnchorId) return;
    const overId = findBlockIdFromPoint(this.doc, e.clientX, e.clientY);
    if (!overId) return;
    if (overId !== this.dragAnchorId && this.mode === 'text') {
      this.host.clearNativeSelection();
      this.mode = 'block';
    }
    if (this.mode === 'block') {
      const ids = blockRange(this.host.getDoc(), this.dragAnchorId, overId);
      if (ids.length > 0) this.host.setSelection(blockSelection(ids, this.dragAnchorId, overId));
    }
  };

  private onPointerUp = (): void => {
    this.pointerActive = false;
  };

  /** Esc：把目前的文字選取升級為整塊選取。 */
  enterBlockMode(blockId: string): void {
    this.mode = 'block';
    this.host.clearNativeSelection();
    this.host.setSelection(blockSelection([blockId], blockId, blockId));
  }

  exitBlockMode(): void {
    this.mode = 'text';
  }
}

/** 把選取狀態投影到 DOM（加 data-selected，由 CSS 上色）。 */
export function paintBlockSelection(root: HTMLElement, sel: EditorSelection): void {
  const selected = new Set(sel.type === 'block' ? sel.blockIds : []);
  const all = root.querySelectorAll<HTMLElement>(`[${BLOCK_ID_ATTR}]`);
  for (const el of Array.from(all)) {
    const id = el.getAttribute(BLOCK_ID_ATTR);
    if (id && selected.has(id)) el.setAttribute(SELECTED_ATTR, 'true');
    else el.removeAttribute(SELECTED_ATTR);
  }
  if (selected.size > 0) root.setAttribute('data-block-select-mode', 'true');
  else root.removeAttribute('data-block-select-mode');
}

export { blockRange };
