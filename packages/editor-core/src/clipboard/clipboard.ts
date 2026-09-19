/**
 * 剪貼簿管線。
 *
 * 複製／剪下：三種格式一起寫（自家 JSON / HTML / Markdown）。
 * 貼上：四層優先序
 *   1. application/x-kennote-blocks  自家格式（換新 id 後完美還原）
 *   2. text/html                     自研白名單解析器
 *   3. text/plain 且看起來像 Markdown 自研 Markdown 解析器
 *   4. text/plain                    按行分段
 *
 * 檔案（圖片）不在 editor-core 處理：本 package 不知道後端存在，也不呼叫 fetch。
 * 宿主監聽 paste 事件自行處理 dataTransfer.files（見 README 已知限制）。
 */
import type { DocFragment } from '../model/types.js';
import type { Editor } from '../core.js';
import { orderedRange } from '../selection/types.js';
import { slice } from '../text/richtext.js';
import { insertFragmentOps } from '../transaction/builders.js';
import { parseHTMLToBlocks } from './parse-html.js';
import { looksLikeMarkdown, parseMarkdownToBlocks, parsePlainTextToBlocks } from './parse-markdown.js';
import {
  extractFragment,
  fragmentFromRichText,
  KENNOTE_MIME,
  reassignIds,
  toClipboardPayload,
} from './serialize.js';

/** 取得目前選取的內容片段。 */
export function getSelectedFragment(editor: Editor): DocFragment | null {
  const sel = editor.getSelection();
  if (sel.type === 'block') {
    if (sel.blockIds.length === 0) return null;
    return extractFragment(editor.getDoc(), sel.blockIds);
  }
  const range = orderedRange(sel);
  if (!range || range.start === range.end) return null;
  const block = editor.getBlock(range.blockId);
  if (!block) return null;
  const content = slice(block.content, range.start, range.end);
  return fragmentFromRichText(content, editor.newId, block.type);
}

export function handleCopy(editor: Editor, event: ClipboardEvent): boolean {
  const fragment = getSelectedFragment(editor);
  if (!fragment || !event.clipboardData) return false;
  event.preventDefault();
  const payload = toClipboardPayload(fragment, editor.registry);
  for (const [mime, data] of Object.entries(payload)) {
    try {
      event.clipboardData.setData(mime, data);
    } catch {
      /* 某些瀏覽器對自訂 MIME 有限制，忽略即可 */
    }
  }
  return true;
}

export function handleCut(editor: Editor, event: ClipboardEvent): boolean {
  if (!handleCopy(editor, event)) return false;
  const sel = editor.getSelection();
  editor.history.breakpoint();
  if (sel.type === 'block') {
    editor.deleteBlocks(sel.blockIds);
    return true;
  }
  const range = orderedRange(sel);
  if (range && range.start !== range.end) {
    const block = editor.getBlock(range.blockId);
    if (block) {
      editor.dispatch({
        ops: [
          {
            type: 'block.update',
            blockId: range.blockId,
            patch: { content: [...slice(block.content, 0, range.start), ...slice(block.content, range.end, Infinity)] },
          },
        ],
        selectionAfter: { type: 'text', anchor: { blockId: range.blockId, offset: range.start }, focus: { blockId: range.blockId, offset: range.start } },
        kind: 'deleteText',
        breakHistory: true,
      });
    }
  }
  return true;
}

/** 把剪貼簿資料解析成 fragment（四層優先序）。 */
export function fragmentFromClipboard(editor: Editor, data: DataTransfer): DocFragment | null {
  const read = (mime: string): string => {
    try {
      return data.getData(mime) ?? '';
    } catch {
      return '';
    }
  };

  const own = read(KENNOTE_MIME);
  if (own) {
    try {
      const parsed = JSON.parse(own) as DocFragment;
      if (parsed && Array.isArray(parsed.rootIds) && parsed.blocks) {
        return reassignIds(parsed, editor.newId);
      }
    } catch {
      /* 壞掉的自家格式 → 往下走 */
    }
  }

  const html = read('text/html');
  if (html.trim()) {
    const fragment = parseHTMLToBlocks(html, { newId: editor.newId, document: editor.container.ownerDocument });
    if (fragment.rootIds.length > 0) return fragment;
  }

  const text = read('text/plain');
  if (text) {
    if (looksLikeMarkdown(text)) return parseMarkdownToBlocks(text, { newId: editor.newId });
    return parsePlainTextToBlocks(text, { newId: editor.newId });
  }
  return null;
}

export function handlePaste(editor: Editor, event: ClipboardEvent): boolean {
  if (!event.clipboardData) return false;
  event.preventDefault();
  // 檔案交給宿主處理（editor-core 不上傳、不 fetch）
  if (event.clipboardData.files && event.clipboardData.files.length > 0) return true;
  const fragment = fragmentFromClipboard(editor, event.clipboardData);
  if (!fragment) return true;
  return insertFragment(editor, fragment);
}

export function insertFragment(editor: Editor, fragment: DocFragment): boolean {
  const sel = editor.getSelection();
  let blockId: string;
  let start: number;
  let end: number;

  if (sel.type === 'block') {
    const last = sel.blockIds[sel.blockIds.length - 1];
    if (!last) return false;
    const block = editor.getBlock(last);
    if (!block) return false;
    editor.deleteBlocks(sel.blockIds.slice(0, -1));
    blockId = last;
    start = 0;
    end = Infinity;
  } else {
    const range = orderedRange(sel);
    if (!range) return false;
    blockId = range.blockId;
    start = range.start;
    end = range.end;
  }

  const block = editor.getBlock(blockId);
  if (!block) return false;
  const total = end === Infinity ? Number.MAX_SAFE_INTEGER : end;
  const built = insertFragmentOps(editor.getDoc(), blockId, start, total, fragment, editor.builderCtx);
  editor.history.breakpoint();
  return editor.dispatchBuild(built, { kind: 'structural', source: 'paste', breakHistory: true });
}
