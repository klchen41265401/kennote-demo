/**
 * 複製 / 剪下：同時寫入三種格式。
 *   1. application/x-kennote-blocks  自家格式，站內貼上完美還原（含 props 與巢狀）
 *   2. text/html                     貼到 Word / Google Docs / 郵件用
 *   3. text/plain                    用 Markdown 表示（資訊量最大），貼到終端機/編輯器用
 *
 * 安全：text/html 的輸出一律逸出，連結走 safeUrl 白名單。
 */
import type { Block, BlockType, DocFragment, Mark, RichText } from '../model/types.js';
import { isAtom } from '../model/types.js';
import type { BlockRegistry } from '../plugins/block-registry.js';
import { defaultAtomText } from '../text/richtext.js';
import { normalizeMarks } from '../text/marks.js';
import { escapeAttr, escapeHtml, safeUrl } from '../view/dom-utils.js';

export const KENNOTE_MIME = 'application/x-kennote-blocks';

const LIST_TYPES = new Set<BlockType>(['bulletedList', 'numberedList', 'todo']);

/** RichText → 語義化 HTML（給外部應用程式用，不是編輯器內部的 DOM）。 */
export function inlineToHTML(rt: RichText): string {
  let out = '';
  for (const node of rt) {
    const marks = normalizeMarks(node.marks) ?? [];
    const text = isAtom(node) ? defaultAtomText(node) : node.text;
    let inner = escapeHtml(text).replace(/\n/g, '<br>');
    // 由內而外包標籤
    for (const mark of [...marks].reverse()) {
      inner = wrapMark(inner, mark);
    }
    out += inner;
  }
  return out;
}

function wrapMark(inner: string, mark: Mark): string {
  switch (mark.t) {
    case 'b':
      return `<strong>${inner}</strong>`;
    case 'i':
      return `<em>${inner}</em>`;
    case 'u':
      return `<u>${inner}</u>`;
    case 's':
      return `<s>${inner}</s>`;
    case 'code':
      return `<code>${inner}</code>`;
    case 'link': {
      const href = safeUrl(mark.href);
      return href ? `<a href="${escapeAttr(href)}">${inner}</a>` : inner;
    }
    case 'color': {
      const styles: string[] = [];
      if (mark.fg) styles.push(`color:${mark.fg}`);
      if (mark.bg) styles.push(`background-color:${mark.bg}`);
      return styles.length > 0 ? `<span style="${escapeAttr(styles.join(';'))}">${inner}</span>` : inner;
    }
    case 'comment':
      return inner;
    default:
      return inner;
  }
}

/** RichText → Markdown 行內語法。 */
export function inlineToMarkdown(rt: RichText): string {
  let out = '';
  for (const node of rt) {
    const marks = normalizeMarks(node.marks) ?? [];
    let text = isAtom(node) ? defaultAtomText(node) : node.text;
    const keys = new Set(marks.map((m) => m.t));
    if (keys.has('code')) text = `\`${text}\``;
    if (keys.has('b')) text = `**${text}**`;
    if (keys.has('i')) text = `*${text}*`;
    if (keys.has('s')) text = `~~${text}~~`;
    const link = marks.find((m): m is Extract<Mark, { t: 'link' }> => m.t === 'link');
    if (link) {
      const href = safeUrl(link.href);
      if (href) text = `[${text}](${href})`;
    }
    out += text;
  }
  return out;
}

export function inlineToPlainText(rt: RichText): string {
  let out = '';
  for (const node of rt) out += isAtom(node) ? defaultAtomText(node) : node.text;
  return out;
}

function rootsOf(fragment: DocFragment): Block[] {
  return fragment.rootIds.map((id) => fragment.blocks[id]).filter((b): b is Block => !!b);
}

/** Fragment → HTML（連續的清單項會被包進 ul/ol）。 */
export function fragmentToHTML(fragment: DocFragment, registry: BlockRegistry): string {
  return serializeLevel(fragment, fragment.rootIds, registry);
}

function serializeLevel(fragment: DocFragment, ids: string[], registry: BlockRegistry): string {
  let out = '';
  let listTag: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (listTag) {
      out += `</${listTag}>`;
      listTag = null;
    }
  };
  for (const id of ids) {
    const block = fragment.blocks[id];
    if (!block) continue;
    const def = registry.get(block.type);
    const wantList = LIST_TYPES.has(block.type) ? (block.type === 'numberedList' ? 'ol' : 'ul') : null;
    if (wantList !== listTag) {
      closeList();
      if (wantList) {
        out += `<${wantList}>`;
        listTag = wantList;
      }
    }
    const childrenHTML = block.children.length > 0 ? serializeLevel(fragment, block.children, registry) : '';
    out += def.toHTML(block, inlineToHTML(block.content), childrenHTML);
  }
  closeList();
  return out;
}

/** Fragment → Markdown。 */
export function fragmentToMarkdown(fragment: DocFragment, registry: BlockRegistry): string {
  const lines: string[] = [];
  const walk = (ids: string[], depth: number, numbering: { n: number }): void => {
    let counter = 1;
    for (const id of ids) {
      const block = fragment.blocks[id];
      if (!block) continue;
      const def = registry.get(block.type);
      const indent = '  '.repeat(depth);
      const inner = inlineToMarkdown(block.content);
      let text = def.toMarkdown(block, inner, '');
      if (block.type === 'numberedList') text = text.replace(/^1\. /, `${counter++}. `);
      else counter = 1;
      for (const line of text.replace(/\n+$/, '').split('\n')) lines.push(indent + line);
      if (block.children.length > 0) walk(block.children, depth + 1, numbering);
    }
  };
  walk(fragment.rootIds, 0, { n: 1 });
  return lines.join('\n');
}

export function fragmentToPlainText(fragment: DocFragment): string {
  const lines: string[] = [];
  const walk = (ids: string[]): void => {
    for (const id of ids) {
      const block = fragment.blocks[id];
      if (!block) continue;
      lines.push(inlineToPlainText(block.content));
      walk(block.children);
    }
  };
  walk(fragment.rootIds);
  return lines.join('\n');
}

export interface ClipboardPayload {
  [KENNOTE_MIME]: string;
  'text/html': string;
  'text/plain': string;
}

export function toClipboardPayload(fragment: DocFragment, registry: BlockRegistry): Record<string, string> {
  return {
    [KENNOTE_MIME]: JSON.stringify(fragment),
    'text/html': `<meta charset="utf-8">${fragmentToHTML(fragment, registry)}`,
    'text/plain': fragmentToMarkdown(fragment, registry),
  };
}

/** 把 fragment 的 id 全部換新，避免貼回同一份文件時撞 id。 */
export function reassignIds(fragment: DocFragment, newId: () => string): DocFragment {
  const map = new Map<string, string>();
  for (const id of Object.keys(fragment.blocks)) map.set(id, newId());
  const blocks: Record<string, Block> = {};
  for (const [oldId, block] of Object.entries(fragment.blocks)) {
    const id = map.get(oldId)!;
    blocks[id] = {
      ...block,
      id,
      parentId: block.parentId ? map.get(block.parentId) ?? null : null,
      children: block.children.map((c) => map.get(c)).filter((c): c is string => !!c),
      props: { ...block.props },
      content: block.content.slice(),
    };
  }
  return { rootIds: fragment.rootIds.map((id) => map.get(id)!).filter(Boolean), blocks };
}

/** 從文件中抽出一段 fragment（複製用）。 */
export function extractFragment(
  doc: DocFragment,
  blockIds: string[],
  options?: { includeChildren?: boolean },
): DocFragment {
  const includeChildren = options?.includeChildren ?? true;
  const blocks: Record<string, Block> = {};
  const visit = (id: string, parentId: string | null): void => {
    const b = doc.blocks[id];
    if (!b) return;
    const children = includeChildren ? b.children : [];
    blocks[id] = { ...b, parentId, children: children.slice(), props: { ...b.props }, content: b.content.slice() };
    for (const child of children) visit(child, id);
  };
  for (const id of blockIds) visit(id, null);
  return { rootIds: blockIds.filter((id) => !!doc.blocks[id]), blocks };
}

/** 單一 block 的部分內容（文字選取的複製）。 */
export function fragmentFromRichText(content: RichText, newId: () => string, type: BlockType = 'paragraph'): DocFragment {
  const id = newId();
  return {
    rootIds: [id],
    blocks: {
      [id]: { id, parentId: null, type, props: {}, content, children: [], version: 1 },
    },
  };
}

export { rootsOf };
