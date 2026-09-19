import type { RichText } from './richtext.js';

/** 所有 block 型別。新增 block 型別 = 這裡加一個字串 + 前後端各加一個 registry 檔案（04 §10.1） */
export const BLOCK_TYPES = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bulletedList',
  'numberedList',
  'todo',
  'toggle',
  'quote',
  'callout',
  'divider',
  'code',
  'image',
  'file',
  'bookmark',
  'equation',
  'tableOfContents',
  'page',
  'columnList',
  'column',
  'table',
  'tableRow',
  'collectionView',
  'embed',
  'video',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export function isBlockType(v: unknown): v is BlockType {
  return typeof v === 'string' && (BLOCK_TYPES as readonly string[]).includes(v);
}

/** 03 §6.2 的 block_color 語彙 */
export type BlockColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red'
  | 'gray_background'
  | 'brown_background'
  | 'orange_background'
  | 'yellow_background'
  | 'green_background'
  | 'blue_background'
  | 'purple_background'
  | 'pink_background'
  | 'red_background';

export interface BaseProps {
  /** 外觀色（03 §6.2 的 format.block_color，這裡與 props 合流，理由見 ADR 0002） */
  color?: BlockColor;
}

export interface ParagraphProps extends BaseProps {}
export interface HeadingProps extends BaseProps {
  /** 標題可折疊（03 §6.2 heading 的 toggleable） */
  toggleable?: boolean;
}
export interface BulletedListProps extends BaseProps {}
export interface NumberedListProps extends BaseProps {}
export interface TodoProps extends BaseProps {
  checked: boolean;
}
export interface ToggleProps extends BaseProps {
  defaultOpen?: boolean;
}
export interface QuoteProps extends BaseProps {}
export interface CalloutProps extends BaseProps {
  /** emoji 或 file id */
  icon?: string | null;
}
export interface DividerProps {}
export interface CodeProps extends BaseProps {
  language: string;
  wrap?: boolean;
  lineNumbers?: boolean;
  caption?: RichText;
}
export interface MediaProps extends BaseProps {
  /** 內部上傳；與 externalUrl 二擇一 */
  fileId?: string | null;
  externalUrl?: string | null;
  caption?: RichText;
  altText?: string;
  width?: number;
  aspectRatio?: number;
  alignment?: 'left' | 'center' | 'right';
}
export type ImageProps = MediaProps;
export type VideoProps = MediaProps;
export interface FileProps extends MediaProps {
  name?: string;
  size?: number;
}
export interface LinkPreviewMeta {
  title?: string;
  description?: string;
  faviconUrl?: string;
  coverUrl?: string;
  fetchedAt?: string;
  status?: 'ok' | 'error' | 'pending';
}
export interface BookmarkProps extends BaseProps {
  url: string;
  caption?: RichText;
  meta?: LinkPreviewMeta;
}
export interface EmbedProps extends BaseProps {
  url: string;
  caption?: RichText;
  height?: number;
}
export interface EquationProps extends BaseProps {
  expression: string;
}
export interface TableOfContentsProps extends BaseProps {}
/** page 型別的 block = 指向一個子頁面的連結 */
export interface PageBlockProps extends BaseProps {
  pageId: string | null;
}
export interface ColumnListProps {}
export interface ColumnProps {
  /** 同一 columnList 底下所有 column 的 ratio 總和必須為 1 */
  ratio: number;
}
export interface TableProps extends BaseProps {
  columnCount: number;
  hasColumnHeader?: boolean;
  hasRowHeader?: boolean;
  columnWidths?: number[];
}
export interface TableRowProps {
  /** 每個 cell 一段 RichText（table 的 content 欄位不使用） */
  cells: RichText[];
}
export interface CollectionViewProps extends BaseProps {
  collectionId: string | null;
  viewIds: string[];
  height?: number;
}

/** type → props 的對照表。新增型別時 TypeScript 會強迫你補這一行 */
export interface BlockPropsMap {
  paragraph: ParagraphProps;
  heading1: HeadingProps;
  heading2: HeadingProps;
  heading3: HeadingProps;
  bulletedList: BulletedListProps;
  numberedList: NumberedListProps;
  todo: TodoProps;
  toggle: ToggleProps;
  quote: QuoteProps;
  callout: CalloutProps;
  divider: DividerProps;
  code: CodeProps;
  image: ImageProps;
  file: FileProps;
  bookmark: BookmarkProps;
  equation: EquationProps;
  tableOfContents: TableOfContentsProps;
  page: PageBlockProps;
  columnList: ColumnListProps;
  column: ColumnProps;
  table: TableProps;
  tableRow: TableRowProps;
  collectionView: CollectionViewProps;
  embed: EmbedProps;
  video: VideoProps;
}

export type BlockProps = BlockPropsMap[BlockType];

/**
 * 系統的心臟。真值來源自始至終都是 blocks 表（03 §2.1）。
 * 排序真值 = 父節點的 `children` 陣列（03 §5.1 方案 A）。
 */
export interface Block<T extends BlockType = BlockType> {
  id: string;
  /** 這個 block 屬於哪一頁（同一頁的 block 一次載入） */
  pageId: string;
  /** null = 直接掛在頁面根層（順序由 Page.children 決定） */
  parentId: string | null;
  type: T;
  props: BlockPropsMap[T];
  /** 行內內容。divider / columnList 等無文字 block 為 [] */
  content: RichText;
  /** 子 block 的 id 順序（唯一排序真值） */
  children: string[];
  /** 樂觀鎖：每次內容變更 +1 */
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export type AnyBlock = { [K in BlockType]: Block<K> }[BlockType];

/** 不含 children 的建立輸入 */
export interface BlockInput<T extends BlockType = BlockType> {
  id?: string;
  parentId: string | null;
  type: T;
  props?: Partial<BlockPropsMap[T]>;
  content?: RichText;
}
