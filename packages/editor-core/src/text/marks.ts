/**
 * Mark 的比較、排序、合併。
 *
 * 兩個關鍵概念：
 *  - identity key：完整識別一個 mark（含參數）。判斷「這段文字有沒有這個 mark」用它。
 *  - slot key：同一個 slot 只能存在一個 mark（例如一段文字不能同時有兩個 link 或兩個 color）。
 *    套用新 mark 時會先把同 slot 的舊 mark 移除。
 */
import type { Mark } from '../model/types.js';

/** 完整識別（含參數）。normalize 與 toggle 的相等判斷都走這裡。 */
export function markKey(mark: Mark): string {
  switch (mark.t) {
    case 'link':
      return `link:${mark.href}`;
    case 'color':
      return `color:${mark.fg ?? ''}/${mark.bg ?? ''}`;
    case 'comment':
      return `comment:${mark.id}`;
    default:
      return mark.t;
  }
}

/** 同一個 slot 只能有一個 mark。comment 可以疊很多個，所以 slot 含 id。 */
export function markSlot(mark: Mark): string {
  return mark.t === 'comment' ? `comment:${mark.id}` : mark.t;
}

export function sameMark(a: Mark, b: Mark): boolean {
  return markKey(a) === markKey(b);
}

/** 正規化 mark 物件本身（丟掉 undefined 欄位、固定欄位順序），確保可用 JSON 比較。 */
export function canonicalMark(mark: Mark): Mark {
  switch (mark.t) {
    case 'link':
      return { t: 'link', href: mark.href };
    case 'comment':
      return { t: 'comment', id: mark.id };
    case 'color': {
      const out: { t: 'color'; fg?: string; bg?: string } = { t: 'color' };
      if (mark.fg) out.fg = mark.fg;
      if (mark.bg) out.bg = mark.bg;
      return out;
    }
    default:
      return { t: mark.t };
  }
}

/**
 * 正規化 mark 陣列：去重（同 slot 保留最後一個）、正規化每個 mark、依 key 排序。
 * 空陣列回傳 undefined，讓 span 的 JSON 表示唯一。
 */
export function normalizeMarks(marks: Mark[] | undefined): Mark[] | undefined {
  if (!marks || marks.length === 0) return undefined;
  const bySlot = new Map<string, Mark>();
  for (const m of marks) {
    if (!m || typeof m.t !== 'string') continue;
    bySlot.set(markSlot(m), canonicalMark(m));
  }
  if (bySlot.size === 0) return undefined;
  const out = [...bySlot.values()];
  out.sort((a, b) => (markKey(a) < markKey(b) ? -1 : markKey(a) > markKey(b) ? 1 : 0));
  return out;
}

/** 兩個 mark 陣列是否等價（會先 normalize）。 */
export function marksEqual(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  const na = normalizeMarks(a);
  const nb = normalizeMarks(b);
  if (na === undefined || nb === undefined) return na === nb;
  if (na.length !== nb.length) return false;
  for (let i = 0; i < na.length; i++) {
    if (markKey(na[i]!) !== markKey(nb[i]!)) return false;
  }
  return true;
}

/** 正規化後的 mark 陣列組成的比較字串（dom-view 的 key 化 diff 用）。 */
export function marksSignature(marks: Mark[] | undefined): string {
  const n = normalizeMarks(marks);
  return n ? n.map(markKey).join('|') : '';
}

export function hasMark(marks: Mark[] | undefined, mark: Mark): boolean {
  if (!marks) return false;
  return marks.some((m) => sameMark(m, mark));
}

export function hasMarkType(marks: Mark[] | undefined, t: Mark['t']): boolean {
  if (!marks) return false;
  return marks.some((m) => m.t === t);
}

export function findMark<T extends Mark['t']>(marks: Mark[] | undefined, t: T): Extract<Mark, { t: T }> | undefined {
  if (!marks) return undefined;
  return marks.find((m) => m.t === t) as Extract<Mark, { t: T }> | undefined;
}

/** 加上 mark（同 slot 的先移除）。 */
export function addMark(marks: Mark[] | undefined, mark: Mark): Mark[] | undefined {
  const slot = markSlot(mark);
  const rest = (marks ?? []).filter((m) => markSlot(m) !== slot);
  return normalizeMarks([...rest, mark]);
}

/** 移除 mark（以 identity key 比對；link/color 也接受只給 t 的「移除整個 slot」語義）。 */
export function removeMark(marks: Mark[] | undefined, mark: Mark): Mark[] | undefined {
  if (!marks) return undefined;
  const looseSlot = mark.t === 'link' || mark.t === 'color';
  return normalizeMarks(marks.filter((m) => (looseSlot ? m.t !== mark.t : !sameMark(m, mark))));
}

/** 兩組 marks 的交集（用於 marksAt / 浮動工具列的按鈕狀態）。 */
export function intersectMarks(a: Mark[] | undefined, b: Mark[] | undefined): Mark[] | undefined {
  if (!a || !b) return undefined;
  const bKeys = new Set(b.map(markKey));
  return normalizeMarks(a.filter((m) => bKeys.has(markKey(m))));
}
