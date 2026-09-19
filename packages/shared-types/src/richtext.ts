/**
 * Rich text 資料模型 —— 04 §4.2「扁平 Inline Span 陣列」。
 *
 * 決策紀錄：03 §6.1 另有一套 Notion API 風格的 `{ type, plain_text, text, annotations }`
 * 格式；本專案**不採用**，一律以 04 §4.2 為準（00-README §3 規定 editor-core 與同步協定
 * 以 04 為權威來源）。理由見 docs/adr/0002-richtext-model.md。
 */

/** 一段連續的、格式完全相同的文字。正規化後永不為空字串 */
export interface InlineSpan {
  text: string;
  /** 套用在這段文字上的所有格式。未定義 = 無格式 */
  marks?: Mark[];
}

export type Mark =
  | { t: 'b' }
  | { t: 'i' }
  | { t: 'u' }
  | { t: 's' }
  | { t: 'code' }
  | { t: 'link'; href: string }
  | { t: 'color'; fg?: string; bg?: string }
  | { t: 'comment'; id: string };

export type MarkType = Mark['t'];

/** 所有合法的 mark 種類，供驗證用 */
export const MARK_TYPES = ['b', 'i', 'u', 's', 'code', 'link', 'color', 'comment'] as const;

export type InlineAtomKind = 'mention' | 'date' | 'pageLink' | 'equation';

/** 不可分割的行內物件（占 1 個 offset 單位） */
export interface InlineAtom {
  atom: InlineAtomKind;
  data: Record<string, unknown>;
  marks?: Mark[];
}

export type InlineNode = InlineSpan | InlineAtom;

/** 一個文字 block 的完整內容 */
export type RichText = InlineNode[];

export function isInlineAtom(node: InlineNode): node is InlineAtom {
  return typeof (node as InlineAtom).atom === 'string';
}

export function isInlineSpan(node: InlineNode): node is InlineSpan {
  return typeof (node as InlineSpan).text === 'string';
}

/**
 * 純文字投影。真正的 8 個核心演算法住在 packages/editor-core/src/text/；
 * 這裡只放前後端都需要、且絕對不會有歧義的最小實作（搜尋索引、標題顯示）。
 */
export function richTextToPlainText(rt: RichText | null | undefined): string {
  if (!Array.isArray(rt)) return '';
  let out = '';
  for (const node of rt) {
    if (isInlineSpan(node)) out += node.text;
    else if (isInlineAtom(node)) {
      const d = node.data as { text?: unknown; title?: unknown };
      if (typeof d.text === 'string') out += d.text;
      else if (typeof d.title === 'string') out += d.title;
    }
  }
  return out;
}

/** 由純文字建立最單純的 RichText（空字串 → 空陣列，維持 canonical form） */
export function plainTextToRichText(text: string): RichText {
  return text.length > 0 ? [{ text }] : [];
}
