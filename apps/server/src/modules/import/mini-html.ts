/**
 * 伺服器端的 HTML → Block 解析器（零依賴、零 DOM）。
 *
 * 為什麼不直接用 `editor-core` 的 `parseHTMLToBlocks()`：
 *   那一支需要 `DOMParser` 或一個真的 `Document`（瀏覽器端的正確選擇），
 *   而 server 沒有 DOM，也不該為了匯入而裝 jsdom（開發相依 40MB，且
 *   在正式映像裡也得帶著）。這裡自己做一個**只支援我們認得的標籤**的
 *   tokenizer + 樹狀結構，行為與 editor-core 的白名單解析對齊。
 *
 * 安全：解析器只「讀」，永遠不把原始 HTML 放回任何輸出；script/style 直接丟棄，
 * href 只留 http(s)/mailto 與相對路徑。這是零依賴專案取代 DOMPurify 的做法。
 */
import type { Block as CoreBlock, Mark, RichText } from '@kennote/editor-core/src/model/types.js';

/* ── 1. Tokenizer → 樹 ───────────────────────────────── */

export interface MiniElement {
  type: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: MiniNode[];
}
export interface MiniText {
  type: 'text';
  text: string;
}
export type MiniNode = MiniElement | MiniText;

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT_TAGS = new Set(['script', 'style']);
/** 開這些標籤時要先自動關掉同名（或同族）的開啟標籤 */
const AUTO_CLOSE: Record<string, string[]> = {
  li: ['li'],
  p: ['p'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  tr: ['tr', 'td', 'th'],
  dd: ['dd', 'dt'],
  dt: ['dd', 'dt'],
  option: ['option'],
};

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', middot: '·', times: '×', copy: '©', reg: '®',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1]!.toLowerCase();
    const value = m[4] ?? m[5] ?? m[6] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

export function parseHtml(html: string): MiniElement {
  const root: MiniElement = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack: MiniElement[] = [root];
  const top = (): MiniElement => stack[stack.length - 1]!;

  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      pushText(top(), html.slice(i));
      break;
    }
    if (lt > i) pushText(top(), html.slice(i, lt));

    // 註解 / DOCTYPE / 處理指令
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // 關閉標籤
    if (html.startsWith('</', lt)) {
      const end = html.indexOf('>', lt);
      if (end === -1) break;
      const tag = html.slice(lt + 2, end).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s]!.tag === tag) {
          stack.length = s;
          break;
        }
      }
      i = end + 1;
      continue;
    }

    const end = findTagEnd(html, lt);
    if (end === -1) {
      pushText(top(), html.slice(lt));
      break;
    }
    const inside = html.slice(lt + 1, end);
    const selfClosing = inside.endsWith('/');
    const body = selfClosing ? inside.slice(0, -1) : inside;
    const space = body.search(/[\s/]/);
    const tag = (space === -1 ? body : body.slice(0, space)).toLowerCase();
    if (!/^[a-zA-Z][-a-zA-Z0-9:]*$/.test(tag)) {
      pushText(top(), html.slice(lt, end + 1));
      i = end + 1;
      continue;
    }
    const attrs = space === -1 ? {} : parseAttrs(body.slice(space));

    if (RAW_TEXT_TAGS.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, end);
      i = close === -1 ? n : html.indexOf('>', close) + 1;
      continue;
    }

    for (const closable of AUTO_CLOSE[tag] ?? []) {
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s]!.tag === closable) {
          stack.length = s;
          break;
        }
        if (BLOCK_BOUNDARY.has(stack[s]!.tag)) break;
      }
    }

    const el: MiniElement = { type: 'element', tag, attrs, children: [] };
    top().children.push(el);
    if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(el);
    i = end + 1;
  }
  return root;
}

/** 自動關閉時不可以跨過的邊界（避免 `<li>` 關掉外層 `<ul>` 之外的東西） */
const BLOCK_BOUNDARY = new Set(['ul', 'ol', 'table', 'thead', 'tbody', 'tr', 'blockquote', 'details']);

function findTagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from + 1; i < html.length; i++) {
    const ch = html[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

function pushText(parent: MiniElement, raw: string): void {
  if (raw === '') return;
  parent.children.push({ type: 'text', text: decodeEntities(raw) });
}

export function isElement(node: MiniNode): node is MiniElement {
  return node.type === 'element';
}

export function textContent(node: MiniNode): string {
  if (node.type === 'text') return node.text;
  let out = '';
  for (const child of node.children) out += textContent(child);
  return out;
}

export function findFirst(node: MiniElement, predicate: (el: MiniElement) => boolean): MiniElement | null {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (predicate(child)) return child;
    const nested = findFirst(child, predicate);
    if (nested) return nested;
  }
  return null;
}

export function findAll(node: MiniElement, predicate: (el: MiniElement) => boolean): MiniElement[] {
  const out: MiniElement[] = [];
  const walk = (el: MiniElement): void => {
    for (const child of el.children) {
      if (!isElement(child)) continue;
      if (predicate(child)) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

export function hasClass(el: MiniElement, name: string): boolean {
  const cls = el.attrs['class'];
  return !!cls && cls.split(/\s+/).includes(name);
}

/* ── 2. 樹 → Block ───────────────────────────────────── */

const SAFE_URL = /^(https?:|mailto:|tel:|\/|\.\/|\.\.\/|#|[^:]*$)/i;

export function safeHref(href: string): string {
  const trimmed = href.trim();
  if (trimmed === '') return '';
  if (/^\s*javascript:/i.test(trimmed) || /^\s*data:/i.test(trimmed)) return '';
  return SAFE_URL.test(trimmed) ? trimmed : '';
}

interface Builder {
  blocks: Record<string, CoreBlock>;
  rootIds: string[];
  newId: () => string;
}

function addBlock(
  b: Builder,
  parentId: string | null,
  type: string,
  content: RichText,
  props: Record<string, unknown> = {},
): CoreBlock {
  const id = b.newId();
  const block: CoreBlock = {
    id,
    parentId,
    type: type as CoreBlock['type'],
    props,
    content: normalizeRichText(content),
    children: [],
    version: 1,
  };
  b.blocks[id] = block;
  if (parentId === null) b.rootIds.push(id);
  else b.blocks[parentId]?.children.push(id);
  return block;
}

/** 合併相鄰且 marks 相同的 span、丟掉空字串（與 editor-core 的 normalize 同語意） */
export function normalizeRichText(rt: RichText): RichText {
  const out: RichText = [];
  for (const node of rt) {
    if (!('text' in node)) {
      out.push(node);
      continue;
    }
    if (node.text === '') continue;
    const prev = out[out.length - 1];
    if (prev && 'text' in prev && marksKey(prev.marks) === marksKey(node.marks)) {
      out[out.length - 1] = prev.marks ? { text: prev.text + node.text, marks: prev.marks } : { text: prev.text + node.text };
      continue;
    }
    out.push(node);
  }
  return out;
}

function marksKey(marks: Mark[] | undefined): string {
  if (!marks || marks.length === 0) return '';
  return marks
    .map((m) => (m.t === 'link' ? `link:${m.href}` : m.t))
    .sort()
    .join('|');
}

function marksFor(el: MiniElement, inherited: Mark[]): Mark[] {
  let marks = inherited;
  const add = (mark: Mark) => {
    if (!marks.some((m) => m.t === mark.t)) marks = [...marks, mark];
  };
  const style = (el.attrs['style'] ?? '').toLowerCase();

  switch (el.tag) {
    case 'b':
    case 'strong':
      add({ t: 'b' });
      break;
    case 'i':
    case 'em':
      add({ t: 'i' });
      break;
    case 'u':
    case 'ins':
      add({ t: 'u' });
      break;
    case 's':
    case 'del':
    case 'strike':
      add({ t: 's' });
      break;
    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt':
      add({ t: 'code' });
      break;
    case 'mark':
      add({ t: 'color', bg: '#fff3a3' });
      break;
    case 'a': {
      const href = safeHref(el.attrs['href'] ?? '');
      if (href) marks = [...marks.filter((m) => m.t !== 'link'), { t: 'link', href }];
      break;
    }
    default:
      break;
  }

  const weight = /font-weight\s*:\s*([a-z0-9]+)/.exec(style)?.[1];
  if (weight) {
    const numeric = Number(weight);
    if (weight === 'bold' || weight === 'bolder' || (!Number.isNaN(numeric) && numeric >= 600)) add({ t: 'b' });
    else marks = marks.filter((m) => m.t !== 'b'); // Google Docs 的 font-weight:normal 外包裝
  }
  if (/font-style\s*:\s*italic/.test(style)) add({ t: 'i' });
  if (/text-decoration[^;]*underline/.test(style)) add({ t: 'u' });
  if (/text-decoration[^;]*line-through/.test(style)) add({ t: 's' });

  return marks;
}

function collectInline(node: MiniNode, marks: Mark[], out: RichText, preserveWs = false): void {
  if (node.type === 'text') {
    const text = preserveWs ? node.text : node.text.replace(/\s+/g, ' ');
    if (text === '') return;
    out.push(marks.length > 0 ? { text, marks: [...marks] } : { text });
    return;
  }
  if (node.tag === 'br') {
    out.push({ text: '\n' });
    return;
  }
  if (node.tag === 'img') {
    const alt = node.attrs['alt'];
    if (alt) out.push({ text: alt });
    return;
  }
  if (isSkippable(node)) return;
  const next = marksFor(node, marks);
  const pre = preserveWs || node.tag === 'pre';
  for (const child of node.children) collectInline(child, next, out, pre);
}

function isSkippable(el: MiniElement): boolean {
  if (RAW_TEXT_TAGS.has(el.tag)) return true;
  if (el.tag === 'head' || el.tag === 'meta' || el.tag === 'link' || el.tag === 'title') return true;
  // Notion 的 checkbox 是 div，不是文字
  return hasClass(el, 'checkbox');
}

function inlineOf(el: MiniElement, preserveWs = false): RichText {
  const out: RichText = [];
  for (const child of el.children) collectInline(child, [], out, preserveWs);
  return normalizeRichText(trimEdges(out));
}

function trimEdges(rt: RichText): RichText {
  const out = rt.slice();
  while (out.length > 0) {
    const first = out[0]!;
    if (!('text' in first)) break;
    const trimmed = first.text.replace(/^\s+/, '');
    if (trimmed === '') {
      out.shift();
      continue;
    }
    out[0] = first.marks ? { text: trimmed, marks: first.marks } : { text: trimmed };
    break;
  }
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    if (!('text' in last)) break;
    const trimmed = last.text.replace(/\s+$/, '');
    if (trimmed === '') {
      out.pop();
      continue;
    }
    out[out.length - 1] = last.marks ? { text: trimmed, marks: last.marks } : { text: trimmed };
    break;
  }
  return out;
}

const HEADING_MAP: Record<string, string> = {
  h1: 'heading1', h2: 'heading2', h3: 'heading3',
  h4: 'heading3', h5: 'heading3', h6: 'heading3',
};

const CONTAINER_TAGS = new Set([
  '#root', 'html', 'body', 'div', 'section', 'article', 'main', 'header', 'footer',
  'aside', 'nav', 'dl', 'dd', 'dt', 'span', 'font', 'center',
]);

export interface HtmlToBlocksResult {
  /** `<h1 class="page-title">` 或 `<title>`（Notion 匯出的頁面標題） */
  title: string | null;
  rootIds: string[];
  blocks: Record<string, CoreBlock>;
}

export function htmlToBlocks(html: string, newId: () => string): HtmlToBlocksResult {
  const root = parseHtml(html);
  const b: Builder = { blocks: {}, rootIds: [], newId };

  const titleEl =
    findFirst(root, (el) => el.tag === 'h1' && hasClass(el, 'page-title')) ??
    findFirst(root, (el) => el.tag === 'h1');
  const docTitleEl = findFirst(root, (el) => el.tag === 'title');
  const title = titleEl
    ? textContent(titleEl).trim()
    : docTitleEl
      ? textContent(docTitleEl).trim()
      : null;

  const body = findFirst(root, (el) => el.tag === 'body') ?? root;
  const pageBody = findFirst(body, (el) => hasClass(el, 'page-body')) ?? body;
  walk(pageBody, null, b, titleEl);

  return { title: title && title.length > 0 ? title : null, rootIds: b.rootIds, blocks: b.blocks };
}

function hasBlockChild(el: MiniElement): boolean {
  return el.children.some(
    (c) =>
      isElement(c) &&
      (HEADING_MAP[c.tag] !== undefined ||
        ['p', 'ul', 'ol', 'li', 'table', 'blockquote', 'pre', 'hr', 'figure', 'details', 'div', 'section'].includes(c.tag)),
  );
}

function walk(
  container: MiniElement,
  parentId: string | null,
  b: Builder,
  skip: MiniElement | null,
): void {
  let pending: RichText = [];
  const flush = () => {
    const content = normalizeRichText(trimEdges(pending));
    pending = [];
    if (content.length > 0) addBlock(b, parentId, 'paragraph', content);
  };

  for (const node of container.children) {
    if (node.type === 'text') {
      if (node.text.trim() !== '') pending.push({ text: node.text.replace(/\s+/g, ' ') });
      continue;
    }
    if (node === skip || isSkippable(node)) continue;
    const tag = node.tag;

    if (tag === 'br') {
      flush();
      continue;
    }
    if (tag === 'hr') {
      flush();
      addBlock(b, parentId, 'divider', []);
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      flush();
      walkList(node, parentId, b, tag === 'ol' ? 'numberedList' : 'bulletedList');
      continue;
    }
    if (tag === 'li') {
      flush();
      walkListItem(node, parentId, b, 'bulletedList');
      continue;
    }
    if (tag === 'table') {
      flush();
      walkTable(node, parentId, b);
      continue;
    }
    if (tag === 'pre') {
      flush();
      const code = findFirst(node, (el) => el.tag === 'code');
      const language = detectLanguage(node, code);
      const text = textContent(code ?? node).replace(/\n$/, '');
      addBlock(b, parentId, 'code', text.length > 0 ? [{ text }] : [], { language });
      continue;
    }
    if (tag === 'details') {
      flush();
      const summary = node.children.find((c): c is MiniElement => isElement(c) && c.tag === 'summary');
      const toggle = addBlock(b, parentId, 'toggle', summary ? inlineOf(summary) : [], {});
      for (const child of node.children) {
        if (!isElement(child) || child === summary) continue;
        walk({ type: 'element', tag: 'div', attrs: {}, children: [child] }, toggle.id, b, null);
      }
      continue;
    }
    if (tag === 'figure') {
      flush();
      walkFigure(node, parentId, b);
      continue;
    }
    if (tag === 'blockquote') {
      flush();
      if (hasClass(node, 'callout')) {
        walkCallout(node, parentId, b);
      } else if (hasBlockChild(node)) {
        const quote = addBlock(b, parentId, 'quote', [], {});
        walk(node, quote.id, b, null);
      } else {
        addBlock(b, parentId, 'quote', inlineOf(node));
      }
      continue;
    }

    const heading = HEADING_MAP[tag];
    if (heading) {
      flush();
      addBlock(b, parentId, heading, inlineOf(node));
      continue;
    }
    if (tag === 'p') {
      flush();
      const content = inlineOf(node);
      if (content.length > 0) addBlock(b, parentId, 'paragraph', content);
      continue;
    }

    if (CONTAINER_TAGS.has(tag)) {
      if (hasBlockChild(node)) {
        flush();
        walk(node, parentId, b, skip);
      } else {
        collectInline(node, [], pending);
      }
      continue;
    }

    collectInline(node, [], pending);
  }
  flush();
}

function detectLanguage(pre: MiniElement, code: MiniElement | null): string {
  const cls = `${pre.attrs['class'] ?? ''} ${code?.attrs['class'] ?? ''}`;
  return /language-([a-zA-Z0-9+#.-]+)/.exec(cls)?.[1] ?? 'plain';
}

function walkList(list: MiniElement, parentId: string | null, b: Builder, type: string): void {
  const listType = hasClass(list, 'to-do-list') ? 'todo' : hasClass(list, 'toggle') ? 'toggle' : type;
  for (const node of list.children) {
    if (!isElement(node)) continue;
    if (node.tag === 'li') walkListItem(node, parentId, b, listType);
    else if (node.tag === 'ul') walkList(node, parentId, b, 'bulletedList');
    else if (node.tag === 'ol') walkList(node, parentId, b, 'numberedList');
  }
}

function walkListItem(li: MiniElement, parentId: string | null, b: Builder, type: string): void {
  const nested: MiniElement[] = [];
  const inline: RichText = [];
  let checked: boolean | null = null;
  let details: MiniElement | null = null;

  for (const child of li.children) {
    if (isElement(child)) {
      if (child.tag === 'ul' || child.tag === 'ol') {
        nested.push(child);
        continue;
      }
      if (child.tag === 'details') {
        details = child;
        continue;
      }
      // Notion 的 todo 是 <div class="checkbox checkbox-on">，不是 <input>
      if (hasClass(child, 'checkbox')) {
        checked = hasClass(child, 'checkbox-on');
        continue;
      }
      if (child.tag === 'input' && child.attrs['type'] === 'checkbox') {
        checked = 'checked' in child.attrs;
        continue;
      }
    }
    collectInline(child, [], inline);
  }

  if (details) {
    const summary = details.children.find((c): c is MiniElement => isElement(c) && c.tag === 'summary');
    const toggle = addBlock(b, parentId, 'toggle', summary ? inlineOf(summary) : normalizeRichText(trimEdges(inline)));
    for (const child of details.children) {
      if (!isElement(child) || child === summary) continue;
      walk({ type: 'element', tag: 'div', attrs: {}, children: [child] }, toggle.id, b, null);
    }
    return;
  }

  let content = normalizeRichText(trimEdges(inline));
  let blockType = type;
  const props: Record<string, unknown> = {};

  const dataChecked = li.attrs['data-checked'];
  if (dataChecked !== undefined) checked = dataChecked === 'true';
  if (checked !== null) {
    blockType = 'todo';
    props.checked = checked;
  } else if (type === 'todo') {
    blockType = 'todo';
    props.checked = false;
  } else {
    // GitHub 風格的 `- [x] 文字`
    const first = content[0];
    if (first && 'text' in first) {
      const m = /^\[([ xX])\]\s+/.exec(first.text);
      if (m) {
        blockType = 'todo';
        props.checked = m[1]!.toLowerCase() === 'x';
        const rest = first.text.slice(m[0].length);
        content = normalizeRichText([
          ...(rest ? [first.marks ? { text: rest, marks: first.marks } : { text: rest }] : []),
          ...content.slice(1),
        ]);
      }
    }
  }

  const block = addBlock(b, parentId, blockType, content, props);
  for (const child of nested) {
    walkList(child, block.id, b, child.tag === 'ol' ? 'numberedList' : 'bulletedList');
  }
}

function walkCallout(el: MiniElement, parentId: string | null, b: Builder): void {
  const iconEl = findFirst(el, (child) => hasClass(child, 'icon') || hasClass(child, 'callout-icon'));
  const icon = iconEl ? textContent(iconEl).trim() : '';
  const bodyEl =
    findFirst(el, (child) => hasClass(child, 'callout-body')) ??
    el.children.filter((c): c is MiniElement => isElement(c) && c !== iconEl)[1] ??
    el;
  const content = inlineOf(bodyEl === el ? stripChild(el, iconEl) : bodyEl);
  addBlock(b, parentId, 'callout', content, { icon: icon || '💡' });
}

function stripChild(el: MiniElement, child: MiniElement | null): MiniElement {
  if (!child) return el;
  return { ...el, children: el.children.filter((c) => c !== child) };
}

function walkFigure(fig: MiniElement, parentId: string | null, b: Builder): void {
  if (hasClass(fig, 'callout')) {
    walkCallout(fig, parentId, b);
    return;
  }
  const img = findFirst(fig, (el) => el.tag === 'img');
  const caption = findFirst(fig, (el) => el.tag === 'figcaption');
  if (img) {
    const src = safeHref(img.attrs['src'] ?? '');
    addBlock(b, parentId, 'image', [], {
      externalUrl: src,
      altText: img.attrs['alt'] ?? '',
      ...(caption ? { caption: inlineOf(caption) } : {}),
    });
    return;
  }
  const video = findFirst(fig, (el) => el.tag === 'video');
  if (video) {
    addBlock(b, parentId, 'video', [], { externalUrl: safeHref(video.attrs['src'] ?? '') });
    return;
  }
  const pre = findFirst(fig, (el) => el.tag === 'pre');
  if (pre) {
    walk({ type: 'element', tag: 'div', attrs: {}, children: [pre] }, parentId, b, null);
    return;
  }
  const table = findFirst(fig, (el) => el.tag === 'table');
  if (table) {
    walkTable(table, parentId, b);
    return;
  }
  const link = findFirst(fig, (el) => el.tag === 'a');
  if (link && (hasClass(fig, 'link-to-page') || hasClass(fig, 'bookmark'))) {
    const href = safeHref(link.attrs['href'] ?? '');
    const label = textContent(link).trim();
    // 子頁面連結：先當成 paragraph + link mark，由 notion.ts 之後改寫成 page block
    addBlock(b, parentId, 'paragraph', href ? [{ text: label || href, marks: [{ t: 'link', href }] }] : [{ text: label }]);
    return;
  }
  const content = inlineOf(fig);
  if (content.length > 0) addBlock(b, parentId, 'paragraph', content);
}

function walkTable(table: MiniElement, parentId: string | null, b: Builder): void {
  const rows = findAll(table, (el) => el.tag === 'tr');
  if (rows.length === 0) return;
  const cellsOf = (row: MiniElement): RichText[] =>
    row.children
      .filter((c): c is MiniElement => isElement(c) && (c.tag === 'td' || c.tag === 'th'))
      .map((cell) => inlineOf(cell));

  const matrix = rows.map(cellsOf);
  const columnCount = Math.max(1, ...matrix.map((r) => r.length));
  const hasColumnHeader = rows[0]!.children.some((c) => isElement(c) && c.tag === 'th');

  const tableBlock = addBlock(b, parentId, 'table', [], { columnCount, hasColumnHeader });
  for (const cells of matrix) {
    const padded = cells.slice(0, columnCount);
    while (padded.length < columnCount) padded.push([]);
    addBlock(b, tableBlock.id, 'tableRow', [], { cells: padded });
  }
}
