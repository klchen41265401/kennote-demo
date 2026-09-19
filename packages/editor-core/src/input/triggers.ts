/**
 * Slash menu / mention 的觸發偵測。
 *
 * editor-core 只負責「偵測 + 給宿主一個帶 query 與 anchor rect 的事件」，
 * 選單本身由宿主（React）畫。宿主在使用者選定項目時呼叫
 * editor.setBlockType() 或 editor.insertBlockAfter() 即可。
 */
import type { Editor } from '../core.js';
import type { MenuTriggerPayload } from '../core.js';
import { slice, toOffsetText } from '../text/richtext.js';
import { codePointLength } from '../text/offset.js';
import { modelToDom } from '../selection/dom-mapper.js';
import { rectOfRange } from '../selection/caret.js';

const SLASH_CHARS = new Set(['/', '／', '、']); // / ／ 、（台灣使用者習慣用頓號）
const MENTION_CHARS = new Set(['@', '＠']);

interface TriggerState {
  kind: 'slash' | 'mention';
  blockId: string;
  triggerOffset: number;
}

export class MenuTriggerController {
  private state: TriggerState | null = null;
  private readonly editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  get isOpen(): boolean {
    return this.state !== null;
  }

  /** 插入文字之後呼叫。 */
  onTextInserted(blockId: string, caret: number, inserted: string): void {
    const last = [...inserted].pop();
    if (!last) return;
    if (this.state) {
      this.update();
      return;
    }
    const block = this.editor.getBlock(blockId);
    if (!block) return;
    const text = toOffsetText(slice(block.content, 0, caret));
    const before = caret - codePointLength(last) - 1;
    const prevChar = before >= 0 ? toOffsetText(slice(block.content, before, before + 1)) : '';
    const atStart = caret - codePointLength(last) === 0;
    if (!atStart && prevChar !== '' && !/\s/.test(prevChar)) return;

    if (SLASH_CHARS.has(last)) {
      this.state = { kind: 'slash', blockId, triggerOffset: caret - codePointLength(last) };
      this.emit(true);
      return;
    }
    if (MENTION_CHARS.has(last)) {
      this.state = { kind: 'mention', blockId, triggerOffset: caret - codePointLength(last) };
      this.emit(true);
      return;
    }
    void text;
  }

  /** selection 或內容變動後呼叫，更新 query 或關閉。 */
  update(): void {
    const state = this.state;
    if (!state) return;
    const sel = this.editor.getSelection();
    if (sel.type !== 'text' || sel.focus.blockId !== state.blockId) {
      this.close();
      return;
    }
    const block = this.editor.getBlock(state.blockId);
    if (!block) {
      this.close();
      return;
    }
    const caret = sel.focus.offset;
    if (caret <= state.triggerOffset) {
      this.close();
      return;
    }
    const query = toOffsetText(slice(block.content, state.triggerOffset + 1, caret));
    // 觸發字元被刪掉了 → 關閉
    const triggerChar = toOffsetText(slice(block.content, state.triggerOffset, state.triggerOffset + 1));
    if (!SLASH_CHARS.has(triggerChar) && !MENTION_CHARS.has(triggerChar)) {
      this.close();
      return;
    }
    // 空 query 下按空白 → 使用者只是想打斜線
    if (/\s/.test(query)) {
      this.close();
      return;
    }
    this.emit(true, query);
  }

  close(): void {
    if (!this.state) return;
    this.emit(false);
    this.state = null;
  }

  private emit(open: boolean, query = ''): void {
    const state = this.state;
    if (!state) return;
    const payload: MenuTriggerPayload = {
      open,
      blockId: state.blockId,
      triggerOffset: state.triggerOffset,
      query,
      rect: this.anchorRect(state),
    };
    this.editor.emit(state.kind === 'slash' ? 'slashTrigger' : 'mentionTrigger', payload);
  }

  private anchorRect(state: TriggerState): DOMRect | null {
    const contentEl = this.editor.view.getContentEl(state.blockId);
    if (!contentEl) return null;
    try {
      const pos = modelToDom(contentEl, state.triggerOffset);
      const doc = contentEl.ownerDocument;
      const range = doc.createRange();
      range.setStart(pos.node, pos.offset);
      range.collapse(true);
      return rectOfRange(range);
    } catch {
      return null;
    }
  }
}
