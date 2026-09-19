/**
 * DOM 位置 ↔ Model offset 的雙向對映。整個自刻編輯器最容易出錯的模組，因此獨立並重點測試。
 *
 * ── DOM 渲染約定（讓對映變簡單的關鍵，由 view/dom-view.ts 保證）──────────────
 *   <div class="kn-block" data-block-id="b1">
 *     <p class="kn-block-content" contenteditable="true" data-block-content>
 *       <span data-idx="0" data-marks="">Hello </span>
 *       <strong data-idx="1" data-marks="b">world</strong>
 *       <span data-idx="2" data-atom="mention" contenteditable="false">@Ken</span>
 *     </p>
 *   </div>
 *
 *  - 每個 inline node 一個元素，順序與 model 陣列一致（data-idx）。
 *  - atom 元素佔 model 的 1 個 offset，內部 DOM 一律視為不可分割。
 *  - <br> 一律不佔 model 長度：空 block 的佔位 br、結尾軟換行的補償 br、
 *    以及 Firefox 自作主張插入的 br[type=_moz] 都會被忽略（軟換行在 model 裡是 '\n'）。
 *  - DOM 的 offset 是 UTF-16 code unit，model 是 code point，必須經過 offset.ts 轉換。
 */
import type { Mark, RichText } from '../model/types.js';
import { codePointLength, codePointToUtf16, utf16ToCodePoint } from '../text/offset.js';
import { normalize } from '../text/richtext.js';
import { normalizeMarks } from '../text/marks.js';

export const BLOCK_ID_ATTR = 'data-block-id';
export const BLOCK_CONTENT_ATTR = 'data-block-content';
export const IDX_ATTR = 'data-idx';
export const ATOM_ATTR = 'data-atom';
export const MARKS_ATTR = 'data-marks';
export const IGNORE_ATTR = 'data-kn-ignore';

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

function isText(node: Node): node is Text {
  return node.nodeType === 3;
}

/** 這個元素是不是 atom（不可分割，佔 1 個 offset）。 */
export function isAtomEl(node: Node): boolean {
  return isElement(node) && node.hasAttribute(ATOM_ATTR);
}

function isIgnored(node: Node): boolean {
  if (!isElement(node)) return false;
  if (node.hasAttribute(IGNORE_ATTR)) return true;
  const tag = node.tagName;
  return tag === 'BR';
}

/** 一個 DOM 子樹在 model 裡佔多少 offset。 */
export function measureNode(node: Node): number {
  if (isText(node)) return codePointLength(node.data);
  if (!isElement(node)) return 0;
  if (isAtomEl(node)) return 1;
  if (isIgnored(node)) return 0;
  let n = 0;
  for (let c = node.firstChild; c; c = c.nextSibling) n += measureNode(c);
  return n;
}

/** 往上找最近的 block 容器（帶 data-block-id 的元素）。 */
export function closestBlock(node: Node | null): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (isElement(cur) && cur.hasAttribute(BLOCK_ID_ATTR)) return cur;
    cur = cur.parentNode;
  }
  return null;
}

/** 往上找最近的可編輯內容容器。 */
export function closestContentEl(node: Node | null): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (isElement(cur) && cur.hasAttribute(BLOCK_CONTENT_ATTR)) return cur;
    cur = cur.parentNode;
  }
  return null;
}

/** 從 block 容器取出它自己的可編輯內容元素（不會誤抓子 block 的）。 */
export function getContentEl(blockEl: HTMLElement): HTMLElement | null {
  if (blockEl.hasAttribute(BLOCK_CONTENT_ATTR)) return blockEl;
  const found = blockEl.querySelector<HTMLElement>(`[${BLOCK_CONTENT_ATTR}]`);
  if (!found) return null;
  // 確認它屬於這個 block，而不是巢狀子 block 的內容
  return closestBlock(found) === blockEl ? found : null;
}

function ancestorAtom(root: HTMLElement, node: Node): HTMLElement | null {
  let cur: Node | null = node;
  while (cur && cur !== root) {
    if (isAtomEl(cur)) return cur as HTMLElement;
    cur = cur.parentNode;
  }
  return null;
}

function isInside(root: HTMLElement, node: Node): boolean {
  let cur: Node | null = node;
  while (cur) {
    if (cur === root) return true;
    cur = cur.parentNode;
  }
  return false;
}

/** root 之內、node 之前的所有內容佔多少 model offset。 */
function offsetBefore(root: HTMLElement, node: Node): number {
  let acc = 0;
  let cur: Node = node;
  while (cur !== root) {
    const parent: Node | null = cur.parentNode;
    if (!parent) return acc;
    for (let s = parent.firstChild; s && s !== cur; s = s.nextSibling) acc += measureNode(s);
    cur = parent;
  }
  return acc;
}

/**
 * DOM 位置 → Model offset。
 * node 可以是 text node（nodeOffset = UTF-16 offset）或元素（nodeOffset = 子節點索引）。
 */
export function domToModel(contentEl: HTMLElement, node: Node | null, nodeOffset: number): number {
  if (!node || !isInside(contentEl, node)) return 0;

  // 落在 atom 內部 → 夾到 atom 的前緣或後緣
  const atom = ancestorAtom(contentEl, node);
  if (atom) {
    const base = offsetBefore(contentEl, atom);
    if (isText(node)) return nodeOffset >= node.data.length ? base + 1 : base;
    return nodeOffset > 0 ? base + 1 : base;
  }

  if (isText(node)) {
    const local = utf16ToCodePoint(node.data, nodeOffset);
    return offsetBefore(contentEl, node) + local;
  }

  if (isElement(node)) {
    // 元素邊界：offset 是「前面有幾個子節點」
    let acc = node === contentEl ? 0 : offsetBefore(contentEl, node);
    let i = 0;
    for (let c = node.firstChild; c && i < nodeOffset; c = c.nextSibling, i++) acc += measureNode(c);
    return acc;
  }

  return 0;
}

export interface DomPosition {
  node: Node;
  offset: number;
}

/** Model offset → DOM 位置。 */
export function modelToDom(contentEl: HTMLElement, offset: number): DomPosition {
  const target = Math.max(0, offset);
  let acc = 0;
  let lastText: Text | null = null;

  const walk = (parent: Node): DomPosition | null => {
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      if (isText(c)) {
        const len = codePointLength(c.data);
        if (target <= acc + len) return { node: c, offset: codePointToUtf16(c.data, target - acc) };
        acc += len;
        lastText = c;
        continue;
      }
      if (isAtomEl(c)) {
        const parentEl = c.parentNode!;
        if (target === acc) return { node: parentEl, offset: indexOfChild(parentEl, c) };
        acc += 1;
        if (target === acc) {
          // 先看看後面有沒有 text node 可以落腳（游標放在文字節點裡比較穩）
          const after = nextTextNode(c);
          if (after) return { node: after, offset: 0 };
          return { node: parentEl, offset: indexOfChild(parentEl, c) + 1 };
        }
        continue;
      }
      if (isIgnored(c)) continue;
      if (isElement(c)) {
        const found = walk(c);
        if (found) return found;
      }
    }
    return null;
  };

  const found = walk(contentEl);
  if (found) return found;
  if (lastText) return { node: lastText, offset: (lastText as Text).data.length };
  return { node: contentEl, offset: 0 };
}

function indexOfChild(parent: Node, child: Node): number {
  let i = 0;
  for (let c = parent.firstChild; c; c = c.nextSibling, i++) if (c === child) return i;
  return i;
}

function nextTextNode(from: Node): Text | null {
  let cur: Node | null = from;
  while (cur) {
    let sib: Node | null = cur.nextSibling;
    while (sib) {
      const t = firstTextIn(sib);
      if (t) return t;
      sib = sib.nextSibling;
    }
    cur = cur.parentNode;
    if (cur && isElement(cur) && cur.hasAttribute(BLOCK_CONTENT_ATTR)) break;
  }
  return null;
}

function firstTextIn(node: Node): Text | null {
  if (isText(node)) return node;
  if (!isElement(node) || isAtomEl(node) || isIgnored(node)) return null;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    const t = firstTextIn(c);
    if (t) return t;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// DOM → RichText（IME reconcile 與 MutationObserver 對帳的唯一入口）
// ─────────────────────────────────────────────────────────────

const TAG_MARKS: Record<string, Mark> = {
  B: { t: 'b' },
  STRONG: { t: 'b' },
  I: { t: 'i' },
  EM: { t: 'i' },
  U: { t: 'u' },
  S: { t: 's' },
  DEL: { t: 's' },
  STRIKE: { t: 's' },
  CODE: { t: 'code' },
  MARK: { t: 'color', bg: 'yellow' },
};

function parseMarksAttr(el: HTMLElement): Mark[] | null {
  const raw = el.getAttribute(MARKS_ATTR);
  if (raw === null) return null;
  if (raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Mark[]) : [];
  } catch {
    return [];
  }
}

/**
 * 從 DOM 讀回 RichText。
 * 優先信任 data-marks（我們自己渲染的），沒有的話從標籤名推導（瀏覽器/IME 自己塞的節點）。
 */
export function domToRichText(contentEl: HTMLElement): RichText {
  const out: RichText = [];

  const visit = (node: Node, marks: Mark[]): void => {
    if (isText(node)) {
      if (node.data.length > 0) out.push(marks.length > 0 ? { text: node.data, marks: [...marks] } : { text: node.data });
      return;
    }
    if (!isElement(node)) return;
    if (isAtomEl(node)) {
      const raw = node.getAttribute('data-atom-data');
      let data: Record<string, unknown> = {};
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
        } catch {
          data = {};
        }
      }
      const atomType = (node.getAttribute(ATOM_ATTR) ?? 'mention') as 'mention' | 'date' | 'pageLink' | 'equation';
      const m = normalizeMarks(marks);
      out.push(m ? { atom: atomType, data, marks: m } : { atom: atomType, data });
      return;
    }
    if (node.tagName === 'BR') {
      // 我們自己放的佔位 br / 結尾 br 不算內容；瀏覽器插的中間 br 視為軟換行
      if (node.hasAttribute(IGNORE_ATTR) || node.getAttribute('type') === '_moz') return;
      if (!node.nextSibling) return;
      out.push(marks.length > 0 ? { text: '\n', marks: [...marks] } : { text: '\n' });
      return;
    }
    const attrMarks = parseMarksAttr(node);
    let nextMarks: Mark[];
    if (attrMarks !== null) {
      nextMarks = attrMarks;
    } else {
      const inferred = TAG_MARKS[node.tagName];
      nextMarks = inferred ? [...marks, inferred] : marks;
      if (node.tagName === 'A') {
        const href = node.getAttribute('href');
        if (href) nextMarks = [...nextMarks, { t: 'link', href }];
      }
    }
    for (let c = node.firstChild; c; c = c.nextSibling) visit(c, nextMarks);
  };

  for (let c = contentEl.firstChild; c; c = c.nextSibling) visit(c, []);
  return normalize(out);
}
