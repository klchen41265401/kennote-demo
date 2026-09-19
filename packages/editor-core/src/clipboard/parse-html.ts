/**
 * 自研的 HTML → Block[] 解析器（白名單式）。
 *
 * 貼上是使用者最高頻的操作之一，也最能體現編輯器的品質。這個解析器處理：
 *  - 語義標籤：h1-h6、p、ul/ol/li（含巢狀）、blockquote、pre/code、hr、table
 *  - 行內：b/strong、i/em、u、s/del/strike、code、a、br、span
 *  - Word / Google Docs 的 inline style（font-weight / font-style / text-decoration）
 *  - Google Docs 的 <b style="font-weight:normal"> 外層包裝（不可誤判為粗體）
 *  - 其餘未知標籤：只取文字內容，標籤本身丟棄；絕不保留原始 HTML
 *
 * 安全：本解析器不會把來源 HTML 放回 DOM，只會讀取。所有 href 走 safeUrl 白名單，
 * script / style / on* 屬性一律不讀取。這是零依賴專案取代 DOMPurify 的做法（見 README 決策）。
 */
import type { Block, BlockType, DocFragment, Mark, RichText } from '../model/types.js';
import { createId } from '../model/document.js';
import { normalize } from '../text/richtext.js';
import { safeUrl } from '../view/dom-utils.js';

export interface ParseHTMLOptions {
  newId?: () => string;
  /** 測試或 Node 環境可注入 document。 */
  document?: Document;
}

const BLOCK_TAG_MAP: Record<string, BlockType> = {
  P: 'paragraph',
  H1: 'heading1',
  H2: 'heading2',
  H3: 'heading3',
  H4: 'heading3',
  H5: 'heading3',
  H6: 'heading3',
  BLOCKQUOTE: 'quote',
  PRE: 'code',
  HR: 'divider',
};

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'COLGROUP', 'COL']);
const CONTAINER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BODY', 'HTML', 'HEADER', 'FOOTER', 'ASIDE', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'DD', 'DT', 'DL']);
const BLOCKISH = new Set([
  ...Object.keys(BLOCK_TAG_MAP),
  ...CONTAINER_TAGS,
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
]);

interface Builder {
  blocks: Record<string, Block>;
  rootIds: string[];
  newId: () => string;
}

function addBlock(b: Builder, parentId: string | null, type: BlockType, content: RichText, props: Record<string, unknown> = {}): Block {
  const id = b.newId();
  const block: Block = { id, parentId, type, props, content: normalize(content), children: [], version: 1 };
  b.blocks[id] = block;
  if (parentId === null) b.rootIds.push(id);
  else b.blocks[parentId]?.children.push(id);
  return block;
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

function isTextNode(node: Node): node is Text {
  return node.nodeType === 3;
}

function styleOf(el: Element): string {
  return (el.getAttribute('style') ?? '').toLowerCase();
}

/** 從標籤與 inline style 推導 marks（Word / GDocs 大量使用 inline style 而非語義標籤）。 */
function marksFromElement(el: Element, inherited: Mark[]): Mark[] {
  const tag = el.tagName;
  const style = styleOf(el);
  let marks = inherited;

  const add = (mark: Mark) => {
    if (!marks.some((m) => m.t === mark.t)) marks = [...marks, mark];
  };
  const drop = (t: Mark['t']) => {
    marks = marks.filter((m) => m.t !== t);
  };

  if (tag === 'B' || tag === 'STRONG') add({ t: 'b' });
  if (tag === 'I' || tag === 'EM') add({ t: 'i' });
  if (tag === 'U' || tag === 'INS') add({ t: 'u' });
  if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') add({ t: 's' });
  if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') add({ t: 'code' });
  if (tag === 'MARK') add({ t: 'color', bg: '#fff3a3' });
  if (tag === 'A') {
    const href = safeUrl(el.getAttribute('href') ?? '');
    if (href) {
      marks = marks.filter((m) => m.t !== 'link');
      marks = [...marks, { t: 'link', href }];
    }
  }

  // inline style 推導
  const weight = /font-weight\s*:\s*([a-z0-9]+)/.exec(style)?.[1];
  if (weight) {
    const numeric = Number(weight);
    if (weight === 'bold' || weight === 'bolder' || (!Number.isNaN(numeric) && numeric >= 600)) add({ t: 'b' });
    else drop('b'); // Google Docs 的 <b style="font-weight:normal"> 外層包裝
  }
  if (/font-style\s*:\s*italic/.test(style)) add({ t: 'i' });
  else if (/font-style\s*:\s*normal/.test(style)) drop('i');
  if (/text-decoration[^;]*underline/.test(style)) add({ t: 'u' });
  if (/text-decoration[^;]*line-through/.test(style)) add({ t: 's' });

  return marks;
}

function collectInline(node: Node, marks: Mark[], out: RichText, insideCode = false): void {
  if (isTextNode(node)) {
    const raw = node.data;
    if (raw.length === 0) return;
    // 把 HTML 的空白摺疊掉（pre/code 內保留）
    const text = insideCode ? raw : raw.replace(/[\t\n\r]+/g, ' ').replace(/ /g, ' ');
    if (text.length === 0) return;
    out.push(marks.length > 0 ? { text, marks: [...marks] } : { text });
    return;
  }
  if (!isElement(node)) return;
  const tag = node.tagName;
  if (SKIP_TAGS.has(tag)) return;
  if (tag === 'BR') {
    out.push({ text: '\n' });
    return;
  }
  if (tag === 'IMG') {
    const alt = node.getAttribute('alt');
    if (alt) out.push({ text: alt });
    return;
  }
  const nextMarks = marksFromElement(node, marks);
  const code = insideCode || tag === 'PRE' || tag === 'CODE';
  for (let c = node.firstChild; c; c = c.nextSibling) collectInline(c, nextMarks, out, code);
}

function inlineOf(el: Element, insideCode = false): RichText {
  const out: RichText = [];
  for (let c = el.firstChild; c; c = c.nextSibling) collectInline(c, [], out, insideCode);
  return normalize(trimEdges(out));
}

function trimEdges(rt: RichText): RichText {
  const out = rt.slice();
  while (out.length > 0) {
    const first = out[0]!;
    if ('text' in first) {
      const trimmed = first.text.replace(/^[ \t\n]+/, '');
      if (trimmed.length === 0) {
        out.shift();
        continue;
      }
      out[0] = first.marks ? { text: trimmed, marks: first.marks } : { text: trimmed };
    }
    break;
  }
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    if ('text' in last) {
      const trimmed = last.text.replace(/[ \t\n]+$/, '');
      if (trimmed.length === 0) {
        out.pop();
        continue;
      }
      out[out.length - 1] = last.marks ? { text: trimmed, marks: last.marks } : { text: trimmed };
    }
    break;
  }
  return out;
}

function hasBlockChild(el: Element): boolean {
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (isElement(c) && BLOCKISH.has(c.tagName)) return true;
  }
  return false;
}

function walk(container: Element, parentId: string | null, b: Builder): void {
  let pendingInline: RichText = [];
  const flush = () => {
    const content = normalize(trimEdges(pendingInline));
    pendingInline = [];
    if (content.length > 0) addBlock(b, parentId, 'paragraph', content);
  };

  for (let node = container.firstChild; node; node = node.nextSibling) {
    if (isTextNode(node)) {
      const text = node.data.replace(/[\t\n\r]+/g, ' ');
      if (text.trim().length > 0) pendingInline.push({ text });
      continue;
    }
    if (!isElement(node)) continue;
    const tag = node.tagName;
    if (SKIP_TAGS.has(tag)) continue;

    if (tag === 'BR') {
      flush();
      continue;
    }

    if (tag === 'UL' || tag === 'OL') {
      flush();
      walkList(node, parentId, b, tag === 'OL' ? 'numberedList' : 'bulletedList');
      continue;
    }

    if (tag === 'LI') {
      flush();
      walkListItem(node, parentId, b, 'bulletedList');
      continue;
    }

    if (tag === 'TABLE') {
      flush();
      walkTable(node, parentId, b);
      continue;
    }

    if (tag === 'HR') {
      flush();
      addBlock(b, parentId, 'divider', []);
      continue;
    }

    if (tag === 'PRE') {
      flush();
      const language = detectLanguage(node);
      const text = node.textContent ?? '';
      addBlock(b, parentId, 'code', text.length > 0 ? [{ text: text.replace(/\n$/, '') }] : [], { language });
      continue;
    }

    const mapped = BLOCK_TAG_MAP[tag];
    if (mapped) {
      flush();
      if (mapped === 'quote' && hasBlockChild(node)) {
        // blockquote 內含 block 結構 → 第一層當 quote，其餘遞迴
        const quote = addBlock(b, parentId, 'quote', []);
        walk(node, quote.id, b);
        continue;
      }
      const content = inlineOf(node);
      // Word 常見的空 <p>&nbsp;</p> → 略過
      if (content.length === 0 && mapped === 'paragraph') continue;
      addBlock(b, parentId, mapped, content);
      continue;
    }

    if (CONTAINER_TAGS.has(tag)) {
      if (hasBlockChild(node)) {
        flush();
        walk(node, parentId, b);
      } else {
        const content = inlineOf(node);
        if (content.length > 0) {
          flush();
          addBlock(b, parentId, 'paragraph', content);
        }
      }
      continue;
    }

    // 其餘視為行內
    collectInline(node, [], pendingInline);
  }
  flush();
}

function detectLanguage(pre: Element): string {
  const code = pre.querySelector('code');
  const cls = `${pre.className} ${code?.className ?? ''}`;
  const m = /language-([a-zA-Z0-9+#.-]+)/.exec(cls);
  return m?.[1] ?? 'plain';
}

function walkList(listEl: Element, parentId: string | null, b: Builder, type: BlockType): void {
  for (let node = listEl.firstChild; node; node = node.nextSibling) {
    if (!isElement(node)) continue;
    if (node.tagName === 'LI') walkListItem(node, parentId, b, type);
    else if (node.tagName === 'UL') walkList(node, parentId, b, 'bulletedList');
    else if (node.tagName === 'OL') walkList(node, parentId, b, 'numberedList');
  }
}

function walkListItem(li: Element, parentId: string | null, b: Builder, type: BlockType): void {
  // 分離「本行內容」與「巢狀子清單」
  const inline: RichText = [];
  const nested: Element[] = [];
  let checked: boolean | null = null;

  for (let c = li.firstChild; c; c = c.nextSibling) {
    if (isElement(c) && (c.tagName === 'UL' || c.tagName === 'OL')) {
      nested.push(c);
      continue;
    }
    if (isElement(c) && c.tagName === 'INPUT' && c.getAttribute('type') === 'checkbox') {
      checked = c.hasAttribute('checked');
      continue;
    }
    // Notion 的 todo 是 <div class="checkbox checkbox-on"> 而不是 <input>
    if (isElement(c) && /(^|\s)checkbox(\s|$|-)/.test(c.className ?? '')) {
      checked = /checkbox-on/.test(c.className ?? '');
      continue;
    }
    if (isElement(c) && (c.tagName === 'P' || c.tagName === 'DIV') && !hasBlockChild(c)) {
      collectInline(c, [], inline);
      continue;
    }
    collectInline(c, [], inline);
  }

  const dataChecked = li.getAttribute('data-checked');
  if (dataChecked !== null) checked = dataChecked === 'true';

  let content = normalize(trimEdges(inline));
  let blockType = type;
  const props: Record<string, unknown> = {};

  // Notion / GitHub 的 todo 表示法
  if (checked !== null) {
    blockType = 'todo';
    props.checked = checked;
  } else {
    const first = content[0];
    if (first && 'text' in first) {
      const m = /^\[([ xX])\]\s+/.exec(first.text);
      if (m) {
        blockType = 'todo';
        props.checked = m[1]!.toLowerCase() === 'x';
        const rest = first.text.slice(m[0].length);
        content = normalize([rest.length > 0 ? (first.marks ? { text: rest, marks: first.marks } : { text: rest }) : { text: '' }, ...content.slice(1)]);
      }
    }
  }

  const block = addBlock(b, parentId, blockType, content, props);
  for (const child of nested) {
    walkList(child, block.id, b, child.tagName === 'OL' ? 'numberedList' : 'bulletedList');
  }
}

function walkTable(table: Element, parentId: string | null, b: Builder): void {
  // M2-A 尚未實作 table block：降級成每列一個段落（用 | 分隔），資訊不遺失
  const rows = table.querySelectorAll('tr');
  for (const row of Array.from(rows)) {
    const cells = Array.from(row.querySelectorAll('td,th')).map((cell) => (cell.textContent ?? '').trim());
    const text = cells.join(' | ');
    if (text.length > 0) addBlock(b, parentId, 'paragraph', [{ text }]);
  }
}

function getParserDocument(options: ParseHTMLOptions): Document | null {
  if (options.document) return options.document;
  const g = globalThis as unknown as { DOMParser?: new () => DOMParser; document?: Document };
  if (g.DOMParser) return null; // 用 DOMParser 現場解析
  return g.document ?? null;
}

/** HTML 字串 → DocFragment。 */
export function parseHTMLToBlocks(html: string, options: ParseHTMLOptions = {}): DocFragment {
  const b: Builder = { blocks: {}, rootIds: [], newId: options.newId ?? createId };
  const injected = getParserDocument(options);
  let root: Element | null = null;

  if (injected) {
    const holder = injected.createElement('div');
    holder.innerHTML = stripDangerous(html);
    root = holder;
  } else {
    const g = globalThis as unknown as { DOMParser?: new () => DOMParser };
    if (!g.DOMParser) return { rootIds: [], blocks: {} };
    const parsed = new g.DOMParser().parseFromString(stripDangerous(html), 'text/html');
    root = parsed.body;
  }

  if (!root) return { rootIds: [], blocks: {} };
  walk(root, null, b);
  return { rootIds: b.rootIds, blocks: b.blocks };
}

/**
 * 解析前先把明顯危險的片段拿掉。
 * 真正的防線是「白名單式解析」：我們只讀取認得的標籤與屬性，不會把來源 HTML 放回 DOM。
 */
function stripDangerous(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
}
