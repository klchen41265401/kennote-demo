/**
 * 前端 Block Type Registry（04 §10.1 / 02 §3.4 BlockRenderer）。
 *
 * 「一個 block type 的所有知識集中在一個地方」——名稱（中/英）、關鍵字、icon、
 * slash 分組、預設 props、可否有子層、是否有行內內容，以及**給 React 用的 renderer**。
 *
 * 名稱一律照 **Notion 7.34 zh-TW** 的用字（項目符號列表 / 摺疊列表 / 引用 / 標註 /
 * 方程式區塊 …），對照來源 `reference/notion-capture/_slash-menu-full.json`。
 *
 * 和 editor-core 的 BlockRegistry 的分工：
 *   - editor-core registry：vanilla DOM 渲染、分割/合併行為、markdown 捷徑、剪貼簿序列化
 *   - 這一份：UI 層知識（選單文案、icon、React renderer）
 *   兩者由 `hostRegistry.ts` 縫在一起：這裡宣告 renderer 的型別，
 *   hostRegistry 就會把對應的 block 改成「React 掛載點」。
 *
 * 新增一個 block type：
 *   1. shared-types 的 BLOCK_TYPES 加字串
 *   2. 這裡加一筆 BlockSpec（要畫東西就加 Renderer）
 *   3. 後端 block-types 加 validateProps + 新 migration 放寬 chk_blocks_type
 *   → slash menu、轉換選單、block handle 的「轉換成」全部自動支援。
 */
import type { ComponentType } from 'react';
import type { BlockType } from '@kennote/shared-types';
import type { BlockRendererProps } from '../context';
import type { IconName } from '../ui/icons';
import { BookmarkBlock, EmbedBlock, FileBlock, ImageBlock, VideoBlock } from '../renderers/MediaBlocks';
import {
  CollectionViewBlock,
  ColumnBlock,
  EquationBlock,
  PageLinkBlock,
  TableBlock,
  TableOfContentsBlock,
} from '../renderers/StructureBlocks';
import { AudioBlock, BreadcrumbBlock, ButtonBlock, PdfBlock, SyncedBlock } from '../renderers/AdvancedBlocks';
import { CodeChrome } from '../renderers/CodeChrome';

export type SlashGroup = 'basic' | 'media' | 'database' | 'advanced' | 'embed';

export const GROUP_LABELS: Record<SlashGroup, string> = {
  basic: '基本區塊',
  media: '媒體',
  database: '資料庫',
  advanced: '進階區塊',
  embed: '嵌入',
};

export interface BlockSpec {
  type: BlockType;
  /** 中文名稱（選單顯示） */
  label: string;
  /** 英文名稱（搜尋用，也顯示在說明列） */
  labelEn: string;
  description: string;
  icon: IconName;
  group: SlashGroup;
  /** 中英文都放，slash menu 直接吃這個 */
  keywords: string[];
  sortOrder: number;
  defaultProps: Record<string, unknown>;
  canHaveChildren: boolean;
  hasInlineContent: boolean;
  /** slash menu 選定後：轉換目前 block，或在下方插入新 block */
  insertMode: 'convert' | 'insert';
  /** 出現在「轉換成」選單 */
  convertible: boolean;
  /** 快捷鍵提示文字 */
  shortcut?: string;
  /**
   * React renderer。有值代表這個 type 由 React 畫（editor-core 只產生掛載容器）。
   * `chrome: true` 代表 editor-core 仍負責可編輯內容，React 只補周邊 UI（例如 code 的工具列）。
   */
  Renderer?: ComponentType<BlockRendererProps>;
  /** true = React 只是附加 chrome，block 仍可編輯文字 */
  chromeOnly?: boolean;
}

const SPECS: BlockSpec[] = [
  /* ── 基本區塊 ── */
  {
    type: 'paragraph',
    label: '文字',
    labelEn: 'Text',
    description: '用純文字開始寫作',
    icon: 'text',
    group: 'basic',
    keywords: ['text', 'paragraph', 'plain', '文字', '段落', '內文', '純文字'],
    sortOrder: 10,
    defaultProps: {},
    canHaveChildren: true,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
    shortcut: 'Ctrl+Shift+0',
  },
  {
    type: 'heading1',
    label: '標題 1',
    labelEn: 'Heading 1',
    description: '最大的段落標題',
    icon: 'heading-1',
    group: 'basic',
    keywords: ['h1', 'heading', 'title', '標題', '標題1', '大標'],
    sortOrder: 20,
    defaultProps: {},
    canHaveChildren: true,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
    shortcut: 'Ctrl+Shift+1',
  },
  {
    type: 'heading2',
    label: '標題 2',
    labelEn: 'Heading 2',
    description: '中等大小的段落標題',
    icon: 'heading-2',
    group: 'basic',
    keywords: ['h2', 'heading', 'subtitle', '標題', '標題2', '中標'],
    sortOrder: 30,
    defaultProps: {},
    canHaveChildren: true,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
    shortcut: 'Ctrl+Shift+2',
  },
  {
    type: 'heading3',
    label: '標題 3',
    labelEn: 'Heading 3',
    description: '較小的段落標題',
    icon: 'heading-3',
    group: 'basic',
    keywords: ['h3', 'heading', '標題', '標題3', '小標'],
    sortOrder: 40,
    defaultProps: {},
    canHaveChildren: true,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
    shortcut: 'Ctrl+Shift+3',
  },
  {
    type: 'heading4',
    label: '標題 4',
    labelEn: 'Heading 4',
    description: '最小的段落標題',
    icon: 'heading-4',
    group: 'basic',
    keywords: ['h4', 'heading', '標題', '標題4', '小標'],
    sortOrder: 45,
    defaultProps: {},
    canHaveChildren: true,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
  },
  {
    type: 'bulletedList',
    label: '項目符號列表',
    labelEn: 'Bulleted list',
    description: '建立一份簡單的列表',
    icon: 'list-bulleted',
    group: 'basic',
    keywords: ['bullet', 'list', 'ul', 'unordered', '清單', '列表', '項目', '無序', '點'],
    sortOrder: 50,
    defaultProps: {},
    canHaveChildren: true,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
    shortcut: 'Ctrl+Shift+4',
  },
  {
    type: 'numberedList',
    label: '編號列表',
    labelEn: 'Numbered list',
    description: '建立有順序的列表',
    icon: 'list-numbered',
    group: 'basic',
    keywords: ['number', 'ordered', 'ol', 'list', '編號', '有序', '清單', '列表', '數字'],
    sortOrder: 60,
    defaultProps: {},
    canHaveChildren: true,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
    shortcut: 'Ctrl+Shift+5',
  },
  {
    type: 'todo',
    label: '待辦清單',
    labelEn: 'To-do list',
    description: '用勾選框追蹤任務',
    icon: 'checkbox',
    group: 'basic',
    keywords: ['todo', 'task', 'checkbox', 'check', '待辦', '勾選', '任務', '核取'],
    sortOrder: 70,
    defaultProps: { checked: false },
    canHaveChildren: true,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
    shortcut: 'Ctrl+Shift+6',
  },
  {
    type: 'toggle',
    label: '摺疊列表',
    labelEn: 'Toggle list',
    description: '可展開 / 收合的區塊',
    icon: 'toggle',
    group: 'basic',
    keywords: ['toggle', 'collapse', 'fold', 'detail', '摺疊', '收合', '折疊', '展開'],
    sortOrder: 80,
    defaultProps: { collapsed: false },
    canHaveChildren: true,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
    shortcut: 'Ctrl+Shift+7',
  },
  {
    type: 'page',
    label: '頁面',
    labelEn: 'Page',
    description: '在這一頁裡建立新的子頁面',
    icon: 'page',
    group: 'basic',
    keywords: ['page', 'subpage', 'child', '頁面', '子頁面', '新頁'],
    sortOrder: 85,
    defaultProps: { pageId: null },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: PageLinkBlock,
  },
  {
    type: 'quote',
    label: '引用',
    labelEn: 'Quote',
    description: '引用一段話',
    icon: 'quote',
    group: 'basic',
    keywords: ['quote', 'blockquote', 'cite', '引言', '引用', '語錄'],
    sortOrder: 90,
    defaultProps: {},
    canHaveChildren: true,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
    shortcut: 'Ctrl+Shift+8',
  },
  {
    type: 'table',
    label: '表格',
    labelEn: 'Table',
    description: '用簡單的表格排版（非資料庫）',
    icon: 'table',
    group: 'basic',
    keywords: ['table', 'grid', 'cell', '表格', '格子', '欄位'],
    sortOrder: 95,
    defaultProps: { columnCount: 3, hasColumnHeader: true },
    canHaveChildren: true,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: TableBlock,
  },
  {
    type: 'callout',
    label: '標註',
    labelEn: 'Callout',
    description: '讓一段文字更醒目',
    icon: 'callout',
    group: 'basic',
    keywords: ['callout', 'note', 'info', 'tip', 'warning', '標註', '提示', '強調', '注意'],
    sortOrder: 100,
    defaultProps: { icon: '💡', color: 'default' },
    canHaveChildren: true,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
    shortcut: 'Ctrl+Shift+9',
  },
  {
    type: 'divider',
    label: '分隔線',
    labelEn: 'Divider',
    description: '用一條線分隔內容',
    icon: 'divider',
    group: 'basic',
    keywords: ['divider', 'hr', 'line', 'separator', '分隔', '分隔線', '水平線', '線'],
    sortOrder: 110,
    defaultProps: {},
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'convert',
    convertible: false,
  },

  /* ── 媒體 ── */
  {
    type: 'image',
    label: '圖片',
    labelEn: 'Image',
    description: '上傳或嵌入圖片',
    icon: 'image',
    group: 'media',
    keywords: ['image', 'picture', 'photo', 'img', 'upload', '圖片', '圖', '照片', '上傳'],
    sortOrder: 200,
    defaultProps: { fileId: null, externalUrl: null, alignment: 'left' },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: ImageBlock,
  },
  {
    type: 'video',
    label: '影片',
    labelEn: 'Video',
    description: '上傳影片或貼上 YouTube 連結',
    icon: 'video',
    group: 'media',
    keywords: ['video', 'youtube', 'vimeo', 'movie', '影片', '視訊', '影音'],
    sortOrder: 205,
    defaultProps: { fileId: null, externalUrl: null },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: VideoBlock,
  },
  {
    type: 'audio',
    label: '音訊',
    labelEn: 'Audio',
    description: '上傳音訊檔或貼上連結',
    icon: 'audio',
    group: 'media',
    keywords: ['audio', 'music', 'sound', 'mp3', 'podcast', '音訊', '音樂', '聲音', '錄音'],
    sortOrder: 210,
    defaultProps: { fileId: null, externalUrl: null },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: AudioBlock,
  },
  {
    type: 'code',
    label: '程式碼',
    labelEn: 'Code',
    description: '帶語法高亮的程式碼區塊',
    icon: 'code',
    group: 'media',
    keywords: ['code', 'snippet', 'pre', 'syntax', '程式碼', '程式', '代碼', '語法'],
    sortOrder: 215,
    defaultProps: { language: 'plain' },
    canHaveChildren: false,
    hasInlineContent: true,
    insertMode: 'convert',
    convertible: true,
    Renderer: CodeChrome,
    chromeOnly: true,
  },
  {
    type: 'file',
    label: '檔案',
    labelEn: 'File',
    description: '上傳任意附件',
    icon: 'file',
    group: 'media',
    keywords: ['file', 'attachment', 'upload', '檔案', '附件', '上傳'],
    sortOrder: 220,
    defaultProps: { fileId: null, externalUrl: null },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: FileBlock,
  },
  {
    type: 'pdf',
    label: 'PDF',
    labelEn: 'PDF',
    description: '嵌入可捲動的 PDF 預覽',
    icon: 'pdf',
    group: 'media',
    keywords: ['pdf', 'document', 'acrobat', '文件', '預覽', '檔案'],
    sortOrder: 225,
    defaultProps: { fileId: null, externalUrl: null },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: PdfBlock,
  },
  {
    type: 'bookmark',
    label: '網頁書籤',
    labelEn: 'Web bookmark',
    description: '把連結存成視覺化書籤',
    icon: 'bookmark',
    group: 'media',
    keywords: ['bookmark', 'link', 'url', 'web', '書籤', '連結', '網址', '網頁'],
    sortOrder: 230,
    defaultProps: { url: '' },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: BookmarkBlock,
  },
  {
    type: 'embed',
    label: '嵌入',
    labelEn: 'Embed',
    description: '嵌入 Figma、地圖等外部內容',
    icon: 'embed',
    group: 'embed',
    keywords: ['embed', 'iframe', 'figma', 'map', 'codepen', '嵌入', '內嵌', '地圖'],
    sortOrder: 240,
    defaultProps: { url: '' },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: EmbedBlock,
  },

  /* ── 進階區塊 ── */
  {
    type: 'equation',
    label: '方程式區塊',
    labelEn: 'Block equation',
    description: '用 LaTeX 顯示數學方程式',
    icon: 'equation',
    group: 'advanced',
    keywords: ['equation', 'math', 'latex', 'formula', '公式', '數學', '方程式'],
    sortOrder: 250,
    defaultProps: { expression: '' },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: EquationBlock,
  },
  {
    type: 'tableOfContents',
    label: '目錄',
    labelEn: 'Table of contents',
    description: '自動彙整本頁標題',
    icon: 'toc',
    group: 'advanced',
    keywords: ['toc', 'contents', 'outline', 'index', '目錄', '大綱', '索引'],
    sortOrder: 260,
    defaultProps: {},
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: TableOfContentsBlock,
  },
  {
    type: 'button',
    label: '按鈕',
    labelEn: 'Button',
    description: '一鍵插入樣板區塊或開啟頁面',
    icon: 'button',
    group: 'advanced',
    keywords: ['button', 'template', 'action', '按鈕', '範本', '樣板', '動作'],
    sortOrder: 265,
    defaultProps: { label: '按鈕', actions: [] },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: ButtonBlock,
  },
  {
    type: 'breadcrumb',
    label: '頁面路徑',
    labelEn: 'Breadcrumb',
    description: '顯示這一頁在頁面樹中的位置',
    icon: 'breadcrumb',
    group: 'advanced',
    keywords: ['breadcrumb', 'path', 'navigation', '麵包屑', '頁面路徑', '路徑', '導覽'],
    sortOrder: 267,
    defaultProps: {},
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: BreadcrumbBlock,
  },
  {
    type: 'syncedBlock',
    label: '同步區塊',
    labelEn: 'Synced block',
    description: '在多個頁面同步顯示同一段內容',
    icon: 'synced',
    group: 'advanced',
    keywords: ['synced', 'sync', 'mirror', 'reuse', '同步', '同步區塊', '共用', '鏡像'],
    sortOrder: 268,
    defaultProps: { syncedFrom: null },
    canHaveChildren: true,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: SyncedBlock,
  },
  {
    type: 'columnList',
    label: '多欄版面',
    labelEn: 'Columns',
    description: '把內容並排成多欄',
    icon: 'columns',
    group: 'advanced',
    keywords: ['column', 'columns', 'layout', 'split', '多欄', '欄位', '分欄', '版面'],
    sortOrder: 280,
    defaultProps: {},
    canHaveChildren: true,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
  },
  {
    type: 'column',
    label: '欄',
    labelEn: 'Column',
    description: '多欄版面中的一欄',
    icon: 'column',
    group: 'advanced',
    keywords: ['column', '欄'],
    sortOrder: 290,
    defaultProps: { ratio: 0.5 },
    canHaveChildren: true,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: ColumnBlock,
  },
  {
    type: 'tableRow',
    label: '表格列',
    labelEn: 'Table row',
    description: '表格中的一列',
    icon: 'table-row',
    group: 'advanced',
    keywords: ['row', '列'],
    sortOrder: 300,
    defaultProps: { cells: [] },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
  },
  {
    type: 'collectionView',
    label: '資料庫',
    labelEn: 'Database',
    description: '在頁面中內嵌資料庫檢視',
    icon: 'database',
    group: 'database',
    keywords: ['database', 'table', 'board', 'collection', 'view', '資料庫', '表格檢視', '看板'],
    sortOrder: 310,
    defaultProps: { collectionId: null, viewIds: [] },
    canHaveChildren: false,
    hasInlineContent: false,
    insertMode: 'insert',
    convertible: false,
    Renderer: CollectionViewBlock,
  },
];

const BY_TYPE = new Map<BlockType, BlockSpec>(SPECS.map((s) => [s.type, s]));

/** slash menu 不應該出現的型別（只會由結構操作產生） */
const HIDDEN_FROM_SLASH = new Set<BlockType>(['column', 'tableRow']);

export function listSpecs(): BlockSpec[] {
  return [...SPECS].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getSpec(type: BlockType): BlockSpec | undefined {
  return BY_TYPE.get(type);
}

/** 有 React renderer 的型別（BlockPortals 用） */
export function specsWithRenderer(): BlockSpec[] {
  return SPECS.filter((s) => s.Renderer);
}

/** 完全由 React 畫（editor-core 只產生掛載容器）的型別 */
export function isReactHosted(type: BlockType): boolean {
  const spec = BY_TYPE.get(type);
  return !!spec?.Renderer && !spec.chromeOnly;
}

export function convertibleSpecs(): BlockSpec[] {
  return listSpecs().filter((s) => s.convertible);
}

/**
 * Slash menu 的搜尋權重（02 §4.1.1）：
 *   label 完全符 > label 前綴符 > keywords 完全符 > keywords 前綴符 > 包含。
 * 中英文一視同仁，所以 `/代碼` 與 `/code` 都能選到程式碼 block。
 */
export function scoreSpec(spec: BlockSpec, query: string): number {
  const q = query.trim().toLowerCase();
  if (q === '') return 100;
  const label = spec.label.toLowerCase();
  const labelEn = spec.labelEn.toLowerCase();
  if (label === q || labelEn === q) return 0;
  if (label.startsWith(q) || labelEn.startsWith(q)) return 1;
  const kws = spec.keywords.map((k) => k.toLowerCase());
  if (kws.some((k) => k === q)) return 2;
  if (kws.some((k) => k.startsWith(q))) return 3;
  if (label.includes(q) || labelEn.includes(q)) return 4;
  if (kws.some((k) => k.includes(q))) return 5;
  return -1;
}

export function searchSpecs(query: string): BlockSpec[] {
  return listSpecs()
    .filter((s) => !HIDDEN_FROM_SLASH.has(s.type))
    .map((s) => ({ s, score: scoreSpec(s, query) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.s.sortOrder - b.s.sortOrder)
    .map((x) => x.s);
}
