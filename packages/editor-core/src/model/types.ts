/**
 * kennote editor-core — 資料模型
 *
 * 紀律：editor-core 是零 runtime 依賴的 package，不 import 任何其他 workspace package。
 * 這份型別與 `@kennote/shared-types` 的 block / richtext 契約保持一致（結構相同、欄位同名），
 * 但刻意各自定義一份，避免 editor-core 產生對外部 package 的耦合。
 * 若契約有變動，兩邊必須同步修改（見 README 的「決策」節）。
 */

// ─────────────────────────────────────────────────────────────
// Inline / RichText
// ─────────────────────────────────────────────────────────────

/** 一段連續的、格式完全相同的文字。text 在 normalize 之後永不為空字串。 */
export interface InlineSpan {
  text: string;
  /** 未定義 = 無格式。normalize 後保證已排序、去重，且空陣列會被移除。 */
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

/** 不可分割的行內物件，佔 1 個 offset 單位。 */
export interface InlineAtom {
  atom: 'mention' | 'date' | 'pageLink' | 'equation';
  data: Record<string, unknown>;
  marks?: Mark[];
}

export type InlineNode = InlineSpan | InlineAtom;
export type RichText = InlineNode[];

export function isSpan(node: InlineNode): node is InlineSpan {
  return typeof (node as InlineSpan).text === 'string';
}

export function isAtom(node: InlineNode): node is InlineAtom {
  return typeof (node as InlineAtom).atom === 'string';
}

// ─────────────────────────────────────────────────────────────
// Block
// ─────────────────────────────────────────────────────────────

export type BlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'bulletedList'
  | 'numberedList'
  | 'todo'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'divider'
  | 'code'
  | 'image'
  | 'file'
  | 'bookmark'
  | 'equation'
  | 'tableOfContents'
  | 'page'
  | 'columnList'
  | 'column'
  | 'table'
  | 'tableRow'
  | 'collectionView'
  | 'embed'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'breadcrumb'
  | 'button'
  | 'syncedBlock';

export interface Block {
  id: string;
  parentId: string | null;
  type: BlockType;
  props: Record<string, unknown>;
  content: RichText;
  children: string[];
  version: number;
}

/** 一份文件 = 根順序 + 所有 block 的扁平 map。 */
export interface EditorDoc {
  rootIds: string[];
  blocks: Record<string, Block>;
}

/** 剪貼簿 / 貼上用的文件片段，結構與 EditorDoc 相同。 */
export type DocFragment = EditorDoc;

export function emptyDoc(): EditorDoc {
  return { rootIds: [], blocks: {} };
}
