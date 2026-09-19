/**
 * 匯出 / 匯入契約（M6）。01 §10、04 §8 M6 第 8–9 項。
 *
 * 資料可攜性是信任基礎：使用者必須能把東西**完整帶走**，也能把既有筆記**搬進來**。
 */

export const EXPORT_FORMATS = ['markdown', 'html', 'csv', 'json', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportFormatMeta {
  label: string;
  description: string;
  /** 單頁匯出時的副檔名（含子頁面 / database 時一律是 .zip） */
  extension: string;
  /** false = 伺服器端不產生檔案（PDF 由前端 window.print() 代勞，見 ADR 0005） */
  serverSide: boolean;
}

export const EXPORT_FORMAT_META: Record<ExportFormat, ExportFormatMeta> = {
  markdown: {
    label: 'Markdown & CSV',
    description: 'Obsidian、Typora 都能直接開；資料庫會一併輸出 CSV',
    extension: 'md',
    serverSide: true,
  },
  html: {
    label: 'HTML',
    description: '自包含樣式的單檔網頁，用瀏覽器就能看',
    extension: 'html',
    serverSide: true,
  },
  csv: {
    label: 'CSV',
    description: '只有資料庫頁面可以匯出成 CSV',
    extension: 'csv',
    serverSide: true,
  },
  json: {
    label: 'JSON（record_map）',
    description: '原樣的內部資料結構，重新匯入不失真',
    extension: 'json',
    serverSide: true,
  },
  pdf: {
    label: 'PDF（用列印）',
    description: '伺服器沒有瀏覽器，改用瀏覽器的列印對話框另存 PDF',
    extension: 'pdf',
    serverSide: false,
  },
};

export interface ExportPageRequest {
  format: ExportFormat;
  /** 連同所有子頁面一起匯出 → 回 zip */
  includeSubpages?: boolean;
  /** 附件（圖片 / 檔案）一併打包進 zip 的 files/ 目錄 */
  includeAttachments?: boolean;
}

/* ── 匯入 ─────────────────────────────────────────────── */

export const IMPORT_SOURCES = ['markdown', 'html', 'notionZip', 'csv', 'text'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export interface ImportSourceMeta {
  label: string;
  description: string;
  /** input[type=file] 的 accept */
  accept: string;
}

export const IMPORT_SOURCE_META: Record<ImportSource, ImportSourceMeta> = {
  markdown: { label: 'Markdown', description: '.md / .markdown 單檔', accept: '.md,.markdown' },
  html: { label: 'HTML', description: '.html / .htm 單檔', accept: '.html,.htm' },
  notionZip: {
    label: 'Notion 匯出檔',
    description: 'Notion 的 Export → Markdown & CSV 或 HTML 的 .zip',
    accept: '.zip',
  },
  csv: { label: 'CSV', description: '一份 CSV = 一個資料庫', accept: '.csv' },
  text: { label: '純文字', description: '.txt，每行一個段落', accept: '.txt' },
};

export interface ImportedPageRef {
  pageId: string;
  title: string;
  isDatabase: boolean;
}

export interface ImportResult {
  /** 建立了幾個頁面（含 database 的列） */
  createdPages: number;
  /** 建立了幾個 database */
  createdDatabases: number;
  /** 匯入後應該跳到哪一頁（第一個頂層頁面） */
  rootPageId: string | null;
  pages: ImportedPageRef[];
  /** 不致命但使用者該知道的事（跳過的檔案、猜不出型別的欄位…） */
  warnings: string[];
  source: ImportSource;
}
