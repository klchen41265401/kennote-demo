/**
 * MutationObserver 安全網。
 *
 * 即使輸入管線寫得再好，瀏覽器仍會偶爾在我們沒預期時改動 DOM
 * （自動更正、拼字修正、瀏覽器擴充功能、IME 的收尾動作）。
 *
 * 正常操作下這個 observer 應該「零觸發」：每一次觸發都代表輸入管線有漏洞，
 * 開發期會 emit 'reconcile' 事件讓人看見；上線後靜默對帳。
 */
import type { Editor } from '../core.js';
import { BLOCK_ID_ATTR, closestBlock, domToRichText, getContentEl } from '../selection/dom-mapper.js';
import { richTextEquals } from '../text/richtext.js';

export interface MutationGuardHost {
  isComposing: boolean;
  /** compositionend 之後的冷卻期（Chrome 會多送事件）。 */
  inCooldown: boolean;
}

export class MutationGuard {
  private observer: MutationObserver | null = null;
  private readonly editor: Editor;
  private readonly host: MutationGuardHost;
  private muted = false;
  /** 觸發次數（測試與開發期監控用：正常操作應為 0）。 */
  triggerCount = 0;

  constructor(editor: Editor, host: MutationGuardHost) {
    this.editor = editor;
    this.host = host;
  }

  attach(root: HTMLElement): void {
    const win = root.ownerDocument.defaultView as (Window & typeof globalThis) | null;
    const Observer = win?.MutationObserver ?? (globalThis as { MutationObserver?: typeof MutationObserver }).MutationObserver;
    if (!Observer) return;
    this.observer = new Observer((records) => this.onMutations(records));
    this.observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: false });
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /** 我們自己造成的變更：丟掉尚未派送的 record。必須在同一個同步任務內呼叫。 */
  discardOwnMutations(): void {
    this.observer?.takeRecords();
  }

  mute<T>(fn: () => T): T {
    this.muted = true;
    try {
      return fn();
    } finally {
      this.discardOwnMutations();
      this.muted = false;
    }
  }

  private onMutations(records: MutationRecord[]): void {
    if (this.muted) return;
    if (this.host.isComposing) return; // 組字期間 DOM 本來就歸瀏覽器管
    if (this.host.inCooldown) return;

    const dirty = new Set<string>();
    for (const record of records) {
      const blockEl = closestBlock(record.target);
      const id = blockEl?.getAttribute(BLOCK_ID_ATTR);
      if (id) dirty.add(id);
    }

    for (const blockId of dirty) {
      if (this.editor.view.isFrozen(blockId)) continue;
      const blockEl = this.editor.view.getBlockEl(blockId);
      const contentEl = blockEl ? getContentEl(blockEl) : null;
      const block = this.editor.getBlock(blockId);
      if (!contentEl || !block) continue;
      const domContent = domToRichText(contentEl);
      if (richTextEquals(domContent, block.content)) continue;

      this.triggerCount += 1;
      this.editor.emit('reconcile', { blockId, reason: 'DOM 與 model 不一致，執行對帳' });
      // DOM 已經被改成這樣了 → 讓 model 追上（skipRender），保持單一真相
      this.editor.dispatch({
        ops: [{ type: 'block.update', blockId, patch: { content: domContent } }],
        source: 'reconcile',
        kind: 'insertText',
        skipRender: true,
        breakHistory: true,
      });
    }
  }
}
