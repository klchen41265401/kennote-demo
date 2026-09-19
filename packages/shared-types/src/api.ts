import type { WorkspaceMember, WorkspaceSummary } from './auth.js';
import type {
  CollectionSchema,
  DatabaseRow,
  DatabaseSnapshot,
  QueryRowsResult,
  RowProperties,
  ViewFormat,
  ViewQuery,
  ViewType,
} from './database.js';
import type { Transaction, TransactionResult } from './operation.js';
import type { Page, PageSnapshot, PageTreeNode, TrashedPage } from './page.js';
import type { RichText } from './richtext.js';

/* ── 健康檢查 ─────────────────────────────────────────── */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  db: boolean;
  version: string;
  uptime: number;
}

/* ── 工作區 ───────────────────────────────────────────── */
export type ListWorkspacesResponse = WorkspaceSummary[];
export type WorkspaceTreeResponse = PageTreeNode[];
export type WorkspaceMembersResponse = WorkspaceMember[];

/* ── 頁面 ─────────────────────────────────────────────── */
export interface CreatePageRequest {
  workspaceId: string;
  parentId?: string | null;
  title?: RichText;
  icon?: string | null;
  /** 指定插入在哪個兄弟之後；null = 排到最前面 */
  afterId?: string | null;
  isDatabase?: boolean;
}

export interface PatchPageRequest {
  title?: RichText;
  icon?: string | null;
  cover?: string | null;
}

export interface MovePageRequest {
  parentId: string | null;
  afterId?: string | null;
}

export interface DuplicatePageResponse {
  page: Page;
  /** 原 id → 新 id 的對照（內部連結重寫用） */
  idMap: Record<string, string>;
}

export type TrashListResponse = TrashedPage[];
export type GetPageSnapshotResponse = PageSnapshot;

/* ── Block transactions ───────────────────────────────── */
export type SubmitTransactionRequest = Omit<Transaction, 'pageId'> & { pageId?: string };
export type SubmitTransactionResponse = TransactionResult;

export interface GetTransactionsQuery {
  since?: number;
  limit?: number;
}
export interface GetTransactionsResponse {
  pageId: string;
  seq: number;
  results: TransactionResult[];
}

/* ── Database ─────────────────────────────────────────── */
export interface CreateDatabaseRequest {
  workspaceId: string;
  parentId?: string | null;
  title?: RichText;
  /** 不給就用預設 schema（只有 title 欄位） */
  schema?: CollectionSchema;
}
export type GetDatabaseResponse = DatabaseSnapshot;

export interface PatchSchemaRequest {
  schema: CollectionSchema;
}

export interface QueryRowsQuery {
  viewId?: string;
  limit?: number;
  offset?: number;
}
export type QueryRowsResponse = QueryRowsResult;

export interface CreateRowRequest {
  title?: RichText;
  properties?: RowProperties;
}
export interface PatchRowRequest {
  title?: RichText;
  icon?: string | null;
  properties?: RowProperties;
}
export type RowResponse = DatabaseRow;

export interface CreateViewRequest {
  type: ViewType;
  name?: string;
  query?: ViewQuery;
  format?: ViewFormat;
}
export interface PatchViewRequest {
  name?: string;
  type?: ViewType;
  query?: ViewQuery;
  format?: ViewFormat;
  manualOrder?: string[];
}

/* ── 檔案 ─────────────────────────────────────────────── */
export interface FileMeta {
  id: string;
  workspaceId: string;
  originalName: string;
  contentType: string;
  size: number;
  url: string;
  createdAt: string;
}
export type UploadFileResponse = FileMeta;

/* ── 搜尋 ─────────────────────────────────────────────── */
// SearchHit / SearchResponse 在 M6 搬到 ./search.ts（多了 parentTitles、type、cursor）。
// 這裡不再重複宣告，index.ts 會一併 re-export。

/* ── 端點總表（給前端 api-client 與文件用的單一事實來源） ── */
export const API_ROUTES = {
  health: '/api/health',
  register: '/api/auth/register',
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  refresh: '/api/auth/refresh',
  me: '/api/auth/me',
  authProviders: '/api/auth/providers',
  workspaces: '/api/workspaces',
  workspaceTree: (id: string) => `/api/workspaces/${id}/tree`,
  workspaceMembers: (id: string) => `/api/workspaces/${id}/members`,
  pages: '/api/pages',
  page: (id: string) => `/api/pages/${id}`,
  pageSnapshot: (id: string) => `/api/pages/${id}/snapshot`,
  pageMove: (id: string) => `/api/pages/${id}/move`,
  pageDuplicate: (id: string) => `/api/pages/${id}/duplicate`,
  pageRestore: (id: string) => `/api/pages/${id}/restore`,
  pageTransactions: (id: string) => `/api/pages/${id}/transactions`,
  trash: '/api/trash',
  databases: '/api/databases',
  database: (id: string) => `/api/databases/${id}`,
  databaseSchema: (id: string) => `/api/databases/${id}/schema`,
  databaseRows: (id: string) => `/api/databases/${id}/rows`,
  databaseRow: (id: string, rowId: string) => `/api/databases/${id}/rows/${rowId}`,
  databaseViews: (id: string) => `/api/databases/${id}/views`,
  databaseView: (id: string, viewId: string) => `/api/databases/${id}/views/${viewId}`,
  fileUpload: '/api/files/upload',
  file: (id: string) => `/api/files/${id}`,
  search: '/api/search',
  recent: '/api/recent',
  pageVisit: (id: string) => `/api/pages/${id}/visit`,
  pageExport: (id: string) => `/api/pages/${id}/export`,
  import: '/api/import',
  metrics: '/api/metrics',
  adminGc: '/api/admin/gc',
  ws: '/ws',
} as const;
