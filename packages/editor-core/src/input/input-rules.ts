/**
 * Markdown 輸入捷徑。
 *
 * 區塊層級（block 起始 + 空白觸發）：# ## ### - * + 1. [] [ ] [x] > >> | ``` ---
 *   → 全部來自 BlockRegistry.markdownShortcut，不散落在鍵盤處理器裡（04 §10.1）。
 * 行內層級（輸入即時轉換）：**粗體** *斜體* `程式碼` ~~刪除線~~
 *
 * IME 防護：組字期間絕不檢查轉換（中文輸入法組字中誤觸會吃掉輸入內容，是繁中使用者最致命的 bug）。
 * 可撤銷：轉換後立刻按 Backspace 或 Cmd+Z 會還原成原始文字（由 InputController 的旗標處理）。
 */
import type { BlockType, Mark, RichText } from '../model/types.js';
import type { Editor } from '../core.js';
import { deleteRange, insertNodes, length as rtLength, slice, toOffsetText } from '../text/richtext.js';
import { codePointLength } from '../text/offset.js';
import { textSelection } from '../selection/types.js';
import type { Operation } from '../transaction/operation.js';

export interface InlineRule {
  /** 對「block 起始到游標」的文字做比對，必須以 $ 結尾。 */
  pattern: RegExp;
  marks: Mark[];
}

export const INLINE_RULES: InlineRule[] = [
  { pattern: /\*\*([^*\s][^*]*)\*\*$/, marks: [{ t: 'b' }] },
  { pattern: /__([^_\s][^_]*)__$/, marks: [{ t: 'b' }] },
  { pattern: /~~([^~\s][^~]*)~~$/, marks: [{ t: 's' }] },
  { pattern: /(?:^|[^*])\*([^*\s][^*]*)\*$/, marks: [{ t: 'i' }] },
  { pattern: /`([^`\s][^`]*)`$/, marks: [{ t: 'code' }] },
];

export interface InputRuleResult {
  kind: 'block' | 'inline';
  blockId: string;
}

/**
 * 區塊層級的 markdown 捷徑。
 * 回傳 true 代表有觸發轉換。
 */
export function applyBlockInputRule(editor: Editor, blockId: string, caret: number): boolean {
  const block = editor.getBlock(blockId);
  if (!block) return false;
  const def = editor.registry.get(block.type);
  const text = toOffsetText(slice(block.content, 0, caret));

  for (const { type, shortcut } of editor.registry.allMarkdownShortcuts()) {
    if (type === block.type && type !== 'divider') continue; // 已經是這個型別了
    const match = shortcut.pattern.exec(text);
    if (!match) continue;
    const prefixLen = codePointLength(match[0]);
    if (prefixLen !== caret) continue; // 必須是「從 block 起始開始」

    const props = shortcut.getProps ? shortcut.getProps(match) : editor.registry.get(type).defaultProps;
    const nextContent = deleteRange(block.content, 0, prefixLen);

    // divider：整個 block 換成分隔線，並在後面補一個空段落給游標
    if (type === 'divider') {
      const newId = editor.newId();
      const ops: Operation[] = [
        { type: 'block.update', blockId, patch: { blockType: 'divider', props: {}, content: [] } },
        {
          type: 'block.insert',
          blockId: newId,
          parentId: block.parentId,
          afterId: blockId,
          blockType: 'paragraph',
          props: {},
          content: nextContent,
        },
      ];
      editor.history.breakpoint();
      return editor.dispatch({
        ops,
        selectionAfter: textSelection(newId, 0),
        kind: 'structural',
        breakHistory: true,
      });
    }

    editor.history.breakpoint();
    return editor.dispatch({
      ops: [{ type: 'block.update', blockId, patch: { blockType: type, props, content: nextContent } }],
      selectionAfter: textSelection(blockId, 0),
      kind: 'structural',
      breakHistory: true,
    });
  }

  // code block 內不跑行內規則
  void def;
  return false;
}

/** 行內 markdown 捷徑（**粗體** 等）。 */
export function applyInlineInputRule(editor: Editor, blockId: string, caret: number): boolean {
  const block = editor.getBlock(blockId);
  if (!block) return false;
  if (block.type === 'code') return false;
  const head = slice(block.content, 0, caret);
  const text = toOffsetText(head);

  for (const rule of INLINE_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const inner = match[1];
    if (inner === undefined || inner.length === 0) continue;
    const whole = match[0];
    // 有些 pattern 會吃掉前一個字元（例如斜體的 [^*]），要扣回來
    const consumed = whole.startsWith('*') || whole.startsWith('_') || whole.startsWith('`') || whole.startsWith('~') ? whole : whole.slice(1);
    const start = caret - codePointLength(consumed);
    if (start < 0) continue;

    // 已經有相同 mark 的範圍就不要重複轉換
    const replaced: RichText = [{ text: inner, marks: rule.marks }];
    const withoutRaw = deleteRange(block.content, start, caret);
    const nextContent = insertNodes(withoutRaw, start, replaced);
    editor.history.breakpoint();
    return editor.dispatch({
      ops: [{ type: 'block.update', blockId, patch: { content: nextContent } }],
      selectionAfter: textSelection(blockId, start + codePointLength(inner)),
      kind: 'format',
      breakHistory: true,
    });
  }
  return false;
}

/** 文字插入後統一跑一次（行內優先，其次區塊）。 */
export function runInputRules(editor: Editor, blockId: string): boolean {
  const sel = editor.getSelection();
  if (sel.type !== 'text' || sel.focus.blockId !== blockId) return false;
  const caret = sel.focus.offset;
  const block = editor.getBlock(blockId);
  if (!block) return false;
  if (caret > rtLength(block.content)) return false;
  if (applyInlineInputRule(editor, blockId, caret)) return true;
  return applyBlockInputRule(editor, blockId, caret);
}

export type { BlockType };
