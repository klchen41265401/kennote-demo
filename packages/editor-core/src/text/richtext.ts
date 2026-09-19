/**
 * RichText 的 8 個核心純函式。整個編輯器的地基。
 *
 * 規則：
 *  1. 全部 zero-side-effect，不碰 DOM，可在 Node 裡完整單元測試。
 *  2. 所有 offset 以 Unicode code point 為單位；atom 佔 1。
 *  3. 每個會產生新 RichText 的函式，結尾都必須呼叫 normalize()，
 *     以保證同一份語義內容永遠只有唯一的正規表示（可用 JSON.stringify 比較相等）。
 */
import type { InlineAtom, InlineNode, InlineSpan, Mark, RichText } from '../model/types.js';
import { isAtom, isSpan } from '../model/types.js';
import { codePointLength, sliceByCodePoint } from './offset.js';
import { hasMark, intersectMarks, marksEqual, marksSignature, normalizeMarks, removeMark, addMark } from './marks.js';

/** 單一 inline node 的長度（span = code point 數；atom = 1）。 */
export function nodeLength(node: InlineNode): number {
  return isSpan(node) ? codePointLength(node.text) : 1;
}

function makeSpan(text: string, marks: Mark[] | undefined): InlineSpan {
  const n = normalizeMarks(marks);
  return n ? { text, marks: n } : { text };
}

function makeAtom(atom: InlineAtom, marks: Mark[] | undefined): InlineAtom {
  const n = normalizeMarks(marks);
  return n ? { atom: atom.atom, data: atom.data, marks: n } : { atom: atom.atom, data: atom.data };
}

/**
 * 正規化：移除空 span、合併相鄰同格式 span、marks 去重排序、欄位順序固定。
 * 冪等：normalize(normalize(x)) === normalize(x)。
 */
export function normalize(rt: RichText | undefined | null): RichText {
  if (!rt || rt.length === 0) return [];
  const out: InlineNode[] = [];
  for (const raw of rt) {
    if (!raw) continue;
    if (isSpan(raw)) {
      if (typeof raw.text !== 'string' || raw.text.length === 0) continue;
      const span = makeSpan(raw.text, raw.marks);
      const prev = out.length > 0 ? out[out.length - 1]! : undefined;
      if (prev && isSpan(prev) && marksEqual(prev.marks, span.marks)) {
        out[out.length - 1] = makeSpan(prev.text + span.text, span.marks);
      } else {
        out.push(span);
      }
    } else if (isAtom(raw)) {
      out.push(makeAtom(raw, raw.marks));
    }
  }
  return out;
}

/** 總長度（code point；atom 算 1）。 */
export function length(rt: RichText): number {
  let n = 0;
  for (const node of rt) n += nodeLength(node);
  return n;
}

/** 取出 [from, to) 的子片段。自動 clamp，from >= to 時回傳 []。 */
export function slice(rt: RichText, from: number, to: number): RichText {
  const total = length(rt);
  const start = Math.max(0, Math.min(from, total));
  const end = Math.max(0, Math.min(to, total));
  if (start >= end) return [];
  const out: InlineNode[] = [];
  let pos = 0;
  for (const node of rt) {
    const len = nodeLength(node);
    const nodeStart = pos;
    const nodeEnd = pos + len;
    pos = nodeEnd;
    if (nodeEnd <= start) continue;
    if (nodeStart >= end) break;
    if (isAtom(node)) {
      // atom 不可分割：只要它的範圍整個落在 [start,end) 內才收
      if (nodeStart >= start && nodeEnd <= end) out.push(node);
      continue;
    }
    const localFrom = Math.max(0, start - nodeStart);
    const localTo = Math.min(len, end - nodeStart);
    const text = sliceByCodePoint(node.text, localFrom, localTo);
    if (text.length > 0) out.push(makeSpan(text, node.marks));
  }
  return normalize(out);
}

/**
 * 在 offset 插入文字。
 * marks 未指定時繼承 offset-1 位置的格式（符合使用者直覺：接著粗體字打字仍是粗體）。
 */
export function insertText(rt: RichText, offset: number, text: string, marks?: Mark[]): RichText {
  if (text.length === 0) return normalize(rt);
  const total = length(rt);
  const at = Math.max(0, Math.min(offset, total));
  const inherited = marks !== undefined ? marks : inheritMarksAt(rt, at);
  return normalize([...slice(rt, 0, at), makeSpan(text, inherited), ...slice(rt, at, total)]);
}

/** 在 offset 插入任意 inline 內容（atom、貼上片段）。 */
export function insertNodes(rt: RichText, offset: number, nodes: RichText): RichText {
  const total = length(rt);
  const at = Math.max(0, Math.min(offset, total));
  return normalize([...slice(rt, 0, at), ...nodes, ...slice(rt, at, total)]);
}

/** 刪除 [from, to)。 */
export function deleteRange(rt: RichText, from: number, to: number): RichText {
  const total = length(rt);
  const start = Math.max(0, Math.min(Math.min(from, to), total));
  const end = Math.max(0, Math.min(Math.max(from, to), total));
  if (start >= end) return normalize(rt);
  return normalize([...slice(rt, 0, start), ...slice(rt, end, total)]);
}

/**
 * 對 [from, to) 套用 mark。
 * Toggle 語義：若範圍內「全部」都已有這個 mark，則改為移除；否則整段套上。
 */
export function toggleMark(rt: RichText, from: number, to: number, mark: Mark): RichText {
  const total = length(rt);
  const start = Math.max(0, Math.min(Math.min(from, to), total));
  const end = Math.max(0, Math.min(Math.max(from, to), total));
  if (start >= end) return normalize(rt);
  const mid = slice(rt, start, end);
  const allHave = mid.length > 0 && mid.every((n) => hasMark(n.marks, mark));
  return applyMarkToRange(rt, start, end, mark, !allHave);
}

/** 明確設定（add=true）或移除（add=false）某個 mark，不做 toggle 判斷。 */
export function applyMarkToRange(rt: RichText, from: number, to: number, mark: Mark, add: boolean): RichText {
  const total = length(rt);
  const start = Math.max(0, Math.min(Math.min(from, to), total));
  const end = Math.max(0, Math.min(Math.max(from, to), total));
  if (start >= end) return normalize(rt);
  const mid = slice(rt, start, end).map((node) => {
    const next = add ? addMark(node.marks, mark) : removeMark(node.marks, mark);
    return isSpan(node) ? makeSpan(node.text, next) : makeAtom(node, next);
  });
  return normalize([...slice(rt, 0, start), ...mid, ...slice(rt, end, total)]);
}

/** 清除 [from, to) 的所有格式。 */
export function clearMarks(rt: RichText, from: number, to: number): RichText {
  const total = length(rt);
  const start = Math.max(0, Math.min(from, total));
  const end = Math.max(0, Math.min(to, total));
  if (start >= end) return normalize(rt);
  const mid = slice(rt, start, end).map((node) =>
    isSpan(node) ? makeSpan(node.text, undefined) : makeAtom(node, undefined),
  );
  return normalize([...slice(rt, 0, start), ...mid, ...slice(rt, end, total)]);
}

/**
 * 查詢 [from, to) 共同擁有的 marks（浮動工具列的按鈕 active 狀態用）。
 * collapsed 時回傳「接著打字會繼承的格式」。
 */
export function marksAt(rt: RichText, from: number, to: number): Mark[] {
  const total = length(rt);
  const start = Math.max(0, Math.min(Math.min(from, to), total));
  const end = Math.max(0, Math.min(Math.max(from, to), total));
  if (start === end) return inheritMarksAt(rt, start) ?? [];
  const mid = slice(rt, start, end);
  if (mid.length === 0) return [];
  let acc: Mark[] | undefined = normalizeMarks(mid[0]!.marks) ?? [];
  for (let i = 1; i < mid.length; i++) {
    acc = intersectMarks(acc, normalizeMarks(mid[i]!.marks) ?? []) ?? [];
  }
  return acc ?? [];
}

/** offset 位置「接著打字」會繼承的 marks：取 offset-1 的 span 格式。 */
export function inheritMarksAt(rt: RichText, offset: number): Mark[] | undefined {
  if (offset <= 0) return undefined;
  let pos = 0;
  for (const node of rt) {
    const len = nodeLength(node);
    if (offset <= pos + len) {
      // 游標剛好在 atom 之後 → 不繼承 atom 的格式（atom 通常自帶樣式）
      if (isAtom(node)) return undefined;
      return normalizeMarks(node.marks);
    }
    pos += len;
  }
  const last = rt.length > 0 ? rt[rt.length - 1]! : undefined;
  return last && isSpan(last) ? normalizeMarks(last.marks) : undefined;
}

export interface PlainTextOptions {
  /** atom 的文字表示。預設嘗試 data.text / data.title / data.label，都沒有就用空字串。 */
  atom?: (atom: InlineAtom) => string;
}

/** 純文字（搜尋索引、匯出、a11y 用）。 */
export function toPlainText(rt: RichText, options?: PlainTextOptions): string {
  let out = '';
  for (const node of rt) {
    if (isSpan(node)) out += node.text;
    else out += options?.atom ? options.atom(node) : defaultAtomText(node);
  }
  return out;
}

/**
 * 與 model offset 完全對齊的文字表示：atom 用 U+FFFC（object replacement character）佔 1 個 code point。
 * grapheme 移動、詞界判斷、input rule 比對都必須用這個，不能用 toPlainText
 * （後者的 atom 文字長度不固定，offset 會對不上）。
 */
export function toOffsetText(rt: RichText): string {
  let out = '';
  for (const node of rt) out += isSpan(node) ? node.text : '￼';
  return out;
}

export function defaultAtomText(atom: InlineAtom): string {
  const d = atom.data;
  for (const key of ['text', 'title', 'label', 'name']) {
    const v = d[key];
    if (typeof v === 'string' && v.length > 0) return atom.atom === 'mention' ? `@${v}` : v;
  }
  if (atom.atom === 'date' && typeof d.iso === 'string') return d.iso;
  if (atom.atom === 'equation' && typeof d.latex === 'string') return d.latex;
  return '';
}

/** 深度相等（兩邊都會先 normalize）。 */
export function richTextEquals(a: RichText, b: RichText): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** 建一段純文字 RichText。 */
export function fromPlainText(text: string, marks?: Mark[]): RichText {
  return text.length === 0 ? [] : normalize([makeSpan(text, marks)]);
}

/** dom-view 的 key 化 diff 用：node 的穩定 signature。 */
export function nodeSignature(node: InlineNode): string {
  return isSpan(node) ? `s:${marksSignature(node.marks)}` : `a:${node.atom}:${marksSignature(node.marks)}`;
}
