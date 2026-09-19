/**
 * IME 狀態機 —— 全專案最高風險區。
 *
 * 策略：平時 Control-First（beforeinput → preventDefault → 改 model → 重繪），
 * composition 期間切到 Reconcile-After（讓瀏覽器自由改 DOM，結束後從 DOM 讀回對帳）。
 *
 *  compositionstart → 凍結該 block 的重繪；不碰 DOM、不套 input rule、不 emit localOps
 *  compositionupdate → 什麼都不做（任何操作都可能讓候選字視窗錯位或組字中斷）
 *  compositionend   → 等一個 frame（Safari 的 DOM/selection 尚未穩定）→ 從 DOM 讀回
 *                     → 與快照 diff → 解除凍結 → dispatch(skipRender) → 沖出排隊的遠端 ops
 */
import type { RichText } from '../model/types.js';
import type { Editor } from '../core.js';
import { domToRichText, getContentEl, domToModel } from '../selection/dom-mapper.js';
import { diffRichText } from '../text/diff.js';
import { length as rtLength } from '../text/richtext.js';
import { textSelection, type EditorSelection } from '../selection/types.js';

/** Chrome 在 compositionend 之後還會多送一次 input；這個時間窗內的雜訊一律忽略。 */
export const COMPOSITION_COOLDOWN_MS = 50;

export class CompositionController {
  isComposing = false;
  lastEndAt = 0;

  private readonly editor: Editor;
  private frozenBlockId: string | null = null;
  private snapshotBefore: RichText | null = null;
  private selBefore: EditorSelection | null = null;
  private attached: HTMLElement | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  attach(root: HTMLElement): void {
    this.attached = root;
    root.addEventListener('compositionstart', this.onStart as EventListener);
    root.addEventListener('compositionupdate', this.onUpdate as EventListener);
    root.addEventListener('compositionend', this.onEnd as EventListener);
  }

  detach(): void {
    const root = this.attached;
    if (!root) return;
    root.removeEventListener('compositionstart', this.onStart as EventListener);
    root.removeEventListener('compositionupdate', this.onUpdate as EventListener);
    root.removeEventListener('compositionend', this.onEnd as EventListener);
    this.attached = null;
  }

  /** 剛結束組字的短暫時間窗（用來過濾 Chrome 多送的事件）。 */
  get inCooldown(): boolean {
    return this.editor.now() - this.lastEndAt < COMPOSITION_COOLDOWN_MS;
  }

  private onStart = (): void => {
    this.isComposing = true;
    const sel = this.editor.getSelection();
    this.editor.emit('compositionChange', true);
    if (sel.type !== 'text') return;
    const blockId = sel.focus.blockId;
    this.frozenBlockId = blockId;
    this.selBefore = sel;
    this.snapshotBefore = this.editor.getBlock(blockId)?.content ?? [];
    // 最重要的一行：凍結這個 block 的重繪。
    // 期間任何 model 變更（含他人的協作 operation）都不得碰這個 block 的 DOM。
    this.editor.view.freeze(blockId);
  };

  private onUpdate = (): void => {
    // 什麼都不做。不讀 DOM、不改 model、不動 selection。
  };

  private onEnd = (): void => {
    // Safari 在 compositionend 當下 DOM 與 selection 可能尚未穩定，必須等一個 frame 再讀。
    nextFrame(this.editor.container.ownerDocument.defaultView, () => this.finish());
  };

  /** 測試可直接呼叫（跳過 rAF）。 */
  finish(): void {
    if (!this.isComposing) return;
    this.isComposing = false;
    this.lastEndAt = this.editor.now();
    const blockId = this.frozenBlockId;
    this.frozenBlockId = null;
    const snapshot = this.snapshotBefore;
    this.snapshotBefore = null;
    const selBefore = this.selBefore ?? this.editor.getSelection();
    this.selBefore = null;

    this.editor.emit('compositionChange', false);

    if (!blockId || !snapshot) {
      this.editor.flushRemoteQueue();
      return;
    }

    const blockEl = this.editor.view.getBlockEl(blockId);
    const contentEl = blockEl ? getContentEl(blockEl) : null;
    if (!contentEl) {
      // 組字中 block 被刪掉了（切換頁面 / 協作）→ 解除凍結就好
      this.editor.view.unfreeze(blockId);
      this.editor.flushRemoteQueue();
      return;
    }

    // 1) 從 DOM 讀回瀏覽器實際產生的內容
    const domContent = domToRichText(contentEl);

    // 2) 讀回目前的游標位置（此時 DOM 才是真相）。
    //    只信任「落在文字節點上」的 selection：組字結束後瀏覽器一定會把游標放進文字節點，
    //    落在容器邊界上的多半是我們組字前寫進去的舊位置，用它會讓游標跳回開頭。
    const domSel = contentEl.ownerDocument.getSelection();
    let caret: number | null = null;
    if (domSel?.focusNode && domSel.focusNode.nodeType === 3 && contentEl.contains(domSel.focusNode)) {
      caret = domToModel(contentEl, domSel.focusNode, domSel.focusOffset);
    }

    // 3) 解除凍結（此時還不重繪）
    this.editor.view.unfreeze(blockId);

    // 4) 與快照 diff，產生最小的 operation
    const diff = diffRichText(snapshot, domContent);
    if (!diff) {
      this.editor.flushRemoteQueue();
      return;
    }

    // 5) 派送（skipRender：DOM 已經是對的，不需要也不應該重繪）
    const caretAfter = caret ?? diff.caretAfter;
    this.editor.dispatch({
      ops: [{ type: 'block.update', blockId, patch: { content: domContent } }],
      selectionBefore: selBefore,
      selectionAfter: textSelection(blockId, caretAfter),
      source: 'ime',
      kind: 'insertText',
      skipRender: true,
      breakHistory: false,
    });

    // 6) 組字期間排隊的遠端變更，現在才套用
    this.editor.flushRemoteQueue();
  }
}

export function nextFrame(win: (Window & typeof globalThis) | null, cb: () => void): void {
  if (win && typeof win.requestAnimationFrame === 'function') {
    win.requestAnimationFrame(() => cb());
    return;
  }
  setTimeout(cb, 0);
}
