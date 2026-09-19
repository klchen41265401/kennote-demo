/**
 * RichText → DOM 的增量渲染。
 *
 * 鐵則：不重建整棵子樹。重建節點 = caret 消失。
 * 做法：把每個 inline node 渲染成「剛好一個元素 + 一個文字節點」，並算出一個穩定的 signature
 * （tag + marks），比對時同 signature 就地改 textContent，不同才替換節點。
 *
 * DOM 形狀（與 selection/dom-mapper.ts 的約定一致）：
 *   <span data-idx="0" data-marks="">純文字</span>
 *   <strong-ish：實際是 span.kn-b data-marks='[{"t":"b"}]'>粗體</span>
 *   <a data-idx="2" data-marks='[{"t":"link",...}]' href="...">連結</a>
 *   <span data-idx="3" data-atom="mention" contenteditable="false">@Ken</span>
 */
import type { InlineAtom, InlineNode, Mark, RichText } from '../model/types.js';
import { isAtom, isSpan } from '../model/types.js';
import { defaultAtomText, normalize } from '../text/richtext.js';
import { findMark, markKey, normalizeMarks } from '../text/marks.js';
import { ATOM_ATTR, IDX_ATTR, IGNORE_ATTR, MARKS_ATTR } from '../selection/dom-mapper.js';
import { safeUrl } from './dom-utils.js';

const SIG_ATTR = 'data-sig';

interface InlinePlan {
  tag: 'span' | 'a' | 'code';
  text: string;
  marks: Mark[] | undefined;
  atom?: InlineAtom;
  className: string;
  href?: string;
  color?: { fg?: string; bg?: string };
  signature: string;
}

function planFor(node: InlineNode, atomText: (a: InlineAtom) => string): InlinePlan {
  const marks = normalizeMarks(node.marks);
  const keys = marks ? marks.map(markKey) : [];
  const link = findMark(marks, 'link');
  const color = findMark(marks, 'color');
  const hasCode = keys.includes('code');

  const classes = ['kn-inline'];
  if (keys.includes('b')) classes.push('kn-b');
  if (keys.includes('i')) classes.push('kn-i');
  if (keys.includes('u')) classes.push('kn-u');
  if (keys.includes('s')) classes.push('kn-s');
  if (hasCode) classes.push('kn-code');
  if (link) classes.push('kn-link');
  if (marks?.some((m) => m.t === 'comment')) classes.push('kn-comment');

  const tag: InlinePlan['tag'] = link ? 'a' : hasCode ? 'code' : 'span';

  if (isAtom(node)) {
    classes.push('kn-atom', `kn-atom-${node.atom}`);
    return {
      tag: 'span',
      text: atomText(node),
      marks,
      atom: node,
      className: classes.join(' '),
      signature: `atom:${node.atom}:${keys.join('|')}`,
    };
  }

  const plan: InlinePlan = {
    tag,
    text: (node as { text: string }).text,
    marks,
    className: classes.join(' '),
    signature: `${tag}:${keys.join('|')}`,
  };
  if (link) plan.href = safeUrl(link.href);
  if (color) plan.color = { fg: color.fg, bg: color.bg };
  return plan;
}

function createEl(doc: Document, plan: InlinePlan, idx: number): HTMLElement {
  const node = doc.createElement(plan.tag);
  applyPlan(node, plan, idx);
  node.appendChild(doc.createTextNode(plan.text));
  return node;
}

function applyPlan(node: HTMLElement, plan: InlinePlan, idx: number): void {
  node.setAttribute(IDX_ATTR, String(idx));
  node.setAttribute(SIG_ATTR, plan.signature);
  node.setAttribute(MARKS_ATTR, plan.marks ? JSON.stringify(plan.marks) : '');
  node.className = plan.className;
  if (plan.href !== undefined) {
    node.setAttribute('href', plan.href);
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (plan.atom) {
    node.setAttribute(ATOM_ATTR, plan.atom.atom);
    node.setAttribute('data-atom-data', JSON.stringify(plan.atom.data));
    node.setAttribute('contenteditable', 'false');
  }
  const style = node.style;
  style.color = plan.color?.fg ?? '';
  style.backgroundColor = plan.color?.bg ?? '';
}

export interface RenderInlineOptions {
  /** atom 的文字表示（宿主可覆寫，例如 mention 顯示使用者名稱）。 */
  atomText?: (atom: InlineAtom) => string;
  /** 空內容時顯示的 placeholder（走 CSS ::before，不放進 DOM 文字節點）。 */
  placeholder?: string;
}

/**
 * 把 RichText 增量渲染進 contentEl。
 * 回傳是否真的動到 DOM（正常輸入路徑下，只有一個文字節點會被改）。
 */
export function renderInline(contentEl: HTMLElement, rt: RichText, options: RenderInlineOptions = {}): boolean {
  const doc = contentEl.ownerDocument;
  const content = normalize(rt);
  const atomText = options.atomText ?? defaultAtomText;
  let mutated = false;

  // 只管我們自己渲染的 inline 元素；其餘（瀏覽器塞的雜節點）一律移除
  const plans = content.map((node) => planFor(node, atomText));

  let cursor: Node | null = contentEl.firstChild;
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]!;
    // 跳過（並記下）不屬於計畫中的節點
    while (cursor && !isRenderableEl(cursor)) {
      const toRemove = cursor;
      cursor = cursor.nextSibling;
      contentEl.removeChild(toRemove);
      mutated = true;
    }
    const existing = cursor as HTMLElement | null;
    if (existing && existing.getAttribute(SIG_ATTR) === plan.signature && existing.tagName.toLowerCase() === plan.tag) {
      // 同 signature → 就地更新（這是打字時的快路徑）
      if (existing.getAttribute(IDX_ATTR) !== String(i)) {
        existing.setAttribute(IDX_ATTR, String(i));
        mutated = true;
      }
      if (plan.href !== undefined && existing.getAttribute('href') !== plan.href) {
        existing.setAttribute('href', plan.href);
        mutated = true;
      }
      if (plan.atom) {
        const nextData = JSON.stringify(plan.atom.data);
        if (existing.getAttribute('data-atom-data') !== nextData) {
          existing.setAttribute('data-atom-data', nextData);
          mutated = true;
        }
      }
      if (existing.style.color !== (plan.color?.fg ?? '')) {
        existing.style.color = plan.color?.fg ?? '';
        mutated = true;
      }
      if (existing.style.backgroundColor !== (plan.color?.bg ?? '')) {
        existing.style.backgroundColor = plan.color?.bg ?? '';
        mutated = true;
      }
      const textNode = firstTextChild(existing);
      if (textNode) {
        if (textNode.data !== plan.text) {
          textNode.data = plan.text;
          mutated = true;
        }
        // 清掉多餘的節點（瀏覽器可能在元素內塞東西）
        while (textNode.nextSibling) {
          existing.removeChild(textNode.nextSibling);
          mutated = true;
        }
      } else {
        while (existing.firstChild) existing.removeChild(existing.firstChild);
        existing.appendChild(doc.createTextNode(plan.text));
        mutated = true;
      }
      cursor = existing.nextSibling;
    } else {
      const fresh = createEl(doc, plan, i);
      contentEl.insertBefore(fresh, cursor);
      mutated = true;
      // cursor 不動：下一輪繼續比對同一個舊節點
    }
  }

  // 空 block 要有 <br> 佔位，否則高度塌陷且游標放不進去；
  // 內容以 '\n' 結尾時也要補一個，否則 pre-wrap 下最後一行不顯示。
  const lastPlan = plans.length > 0 ? plans[plans.length - 1]! : undefined;
  const needsBr = plans.length === 0 || (lastPlan !== undefined && lastPlan.text.endsWith('\n'));
  if (needsBr && cursor && isPlaceholderBr(cursor)) {
    cursor = cursor.nextSibling; // 既有的佔位 br 原地留用，不要churn
  } else if (needsBr) {
    const br = doc.createElement('br');
    br.setAttribute(IGNORE_ATTR, 'true');
    contentEl.insertBefore(br, cursor);
    mutated = true;
  }

  // 移除多餘的尾巴
  while (cursor) {
    const toRemove = cursor;
    cursor = cursor.nextSibling;
    contentEl.removeChild(toRemove);
    mutated = true;
  }

  if (options.placeholder !== undefined) {
    if (contentEl.getAttribute('data-placeholder') !== options.placeholder) {
      contentEl.setAttribute('data-placeholder', options.placeholder);
    }
  }
  const isEmpty = plans.length === 0;
  if (isEmpty !== contentEl.hasAttribute('data-empty')) {
    if (isEmpty) contentEl.setAttribute('data-empty', 'true');
    else contentEl.removeAttribute('data-empty');
  }

  return mutated;
}

function isRenderableEl(node: Node): boolean {
  return node.nodeType === 1 && (node as HTMLElement).hasAttribute(SIG_ATTR);
}

function isPlaceholderBr(node: Node): boolean {
  return node.nodeType === 1 && (node as HTMLElement).tagName === 'BR' && (node as HTMLElement).hasAttribute(IGNORE_ATTR);
}

function firstTextChild(node: HTMLElement): Text | null {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) return c as Text;
  }
  return null;
}
