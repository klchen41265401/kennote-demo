/**
 * database 模組的資料存取。所有寫入都集中在這裡，元件不直接呼叫 api-client
 * （04 §7.3 / 00-README 風險二：元件裡散落寫入呼叫是最難追的 bug 來源）。
 */
import type {
  CastPreview,
  CollectionView,
  DatabaseRow,
  DatabaseSnapshot,
  FieldType,
  PatchSchemaResult,
  QueryRowsResult,
  RichText,
  RowProperties,
  SchemaOp,
  ViewFormat,
  ViewQuery,
  ViewType,
  WorkspaceMember,
} from '@kennote/shared-types';
import { API_ROUTES } from '@kennote/shared-types';
import { invalidateQueries, useQuery } from '@kennote/ui';
import { api } from '../../lib/api-client';

/** API_ROUTES 目前沒有的端點（shared-types/api.ts 由骨架代理維護，不在本模組的改動範圍） */
const ROUTES = {
  previewCast: (id: string) => `${API_ROUTES.databaseSchema(id)}/preview-cast`,
  rowDuplicate: (id: string, rowId: string) => `${API_ROUTES.databaseRow(id, rowId)}/duplicate`,
  viewDuplicate: (id: string, viewId: string) =>
    `${API_ROUTES.databaseView(id, viewId)}/duplicate`,
  exportCsv: (id: string) => `${API_ROUTES.database(id)}/export.csv`,
} as const;

export const databaseKeys = {
  database: (collectionId: string) => ['database', collectionId] as const,
  rows: (collectionId: string, viewId: string | null, signature: string) =>
    ['database', collectionId, 'rows', viewId ?? 'none', signature] as const,
  members: (workspaceId: string) => ['workspace', workspaceId, 'members'] as const,
};

/** 查詢設定的指紋：filter/sort/group/search 一變就重新抓 */
export function querySignature(query: ViewQuery | undefined, search: string): string {
  return JSON.stringify({
    f: query?.filter ?? null,
    s: query?.sort ?? [],
    g: query?.groupBy ?? null,
    a: query?.aggregations ?? null,
    q: search,
  });
}

export function useDatabase(collectionId: string | null) {
  return useQuery<DatabaseSnapshot>({
    key: collectionId ? databaseKeys.database(collectionId) : ['database', 'none'],
    enabled: Boolean(collectionId),
    fetcher: () => api.get<DatabaseSnapshot>(API_ROUTES.database(collectionId as string)),
  });
}

export function useWorkspaceMembers(workspaceId: string | null) {
  return useQuery<WorkspaceMember[]>({
    key: workspaceId ? databaseKeys.members(workspaceId) : ['workspace', 'none', 'members'],
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
    fetcher: () => api.get<WorkspaceMember[]>(API_ROUTES.workspaceMembers(workspaceId as string)),
  });
}

export interface FetchRowsParams {
  collectionId: string;
  viewId?: string | null;
  limit?: number;
  cursor?: string | null;
  search?: string;
}

export function fetchRows(params: FetchRowsParams): Promise<QueryRowsResult> {
  return api.get<QueryRowsResult>(API_ROUTES.databaseRows(params.collectionId), {
    ...(params.viewId ? { viewId: params.viewId } : {}),
    ...(params.limit ? { limit: params.limit } : {}),
    ...(params.cursor ? { cursor: params.cursor } : {}),
    ...(params.search ? { search: params.search } : {}),
    // 相對日期（「今天到期」）要用使用者的時區展開（03 §6.5）
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

/* ── 寫入 ─────────────────────────────────────────────── */

export interface CreateDatabaseInput {
  workspaceId: string;
  parentPageId?: string | null;
  title?: string | RichText;
  inline?: boolean;
}

/**
 * ⭐ 給其他代理用的建立資料庫 helper。
 * 側邊欄的「＋」與頁面的 `/` 選單都呼叫這一支；
 * 回傳的 snapshot 含 collection + 預設 Table 視圖 + 預設欄位。
 */
export async function createDatabase(input: CreateDatabaseInput): Promise<DatabaseSnapshot> {
  const snapshot = await api.post<DatabaseSnapshot>(API_ROUTES.databases, input);
  invalidateQueries(['workspace', input.workspaceId]);
  return snapshot;
}

export async function createRow(
  collectionId: string,
  input: {
    title?: string | RichText;
    properties?: RowProperties;
    group?: { property: string; key: string | null };
  },
): Promise<DatabaseRow> {
  const row = await api.post<DatabaseRow>(API_ROUTES.databaseRows(collectionId), input);
  invalidateQueries(['database', collectionId, 'rows']);
  return row;
}

export async function patchRow(
  collectionId: string,
  rowId: string,
  input: {
    title?: string | RichText;
    icon?: string | null;
    cover?: string | null;
    properties?: RowProperties;
  },
): Promise<DatabaseRow> {
  return api.patch<DatabaseRow>(API_ROUTES.databaseRow(collectionId, rowId), input);
}

export async function deleteRow(collectionId: string, rowId: string): Promise<void> {
  await api.delete(API_ROUTES.databaseRow(collectionId, rowId));
  invalidateQueries(['database', collectionId, 'rows']);
}

export async function duplicateRow(collectionId: string, rowId: string): Promise<DatabaseRow> {
  const row = await api.post<DatabaseRow>(ROUTES.rowDuplicate(collectionId, rowId));
  invalidateQueries(['database', collectionId, 'rows']);
  return row;
}

export async function createView(
  collectionId: string,
  input: { type: ViewType; name?: string; query?: ViewQuery; format?: ViewFormat },
): Promise<CollectionView> {
  const view = await api.post<CollectionView>(API_ROUTES.databaseViews(collectionId), input);
  invalidateQueries(databaseKeys.database(collectionId));
  return view;
}

export async function patchView(
  collectionId: string,
  viewId: string,
  input: {
    name?: string;
    type?: ViewType;
    query?: ViewQuery;
    format?: ViewFormat;
    manualOrder?: string[];
  },
): Promise<CollectionView> {
  const view = await api.patch<CollectionView>(
    API_ROUTES.databaseView(collectionId, viewId),
    input,
  );
  invalidateQueries(databaseKeys.database(collectionId));
  return view;
}

export async function deleteView(collectionId: string, viewId: string): Promise<void> {
  await api.delete(API_ROUTES.databaseView(collectionId, viewId));
  invalidateQueries(databaseKeys.database(collectionId));
}

export async function duplicateView(
  collectionId: string,
  viewId: string,
): Promise<CollectionView> {
  const view = await api.post<CollectionView>(ROUTES.viewDuplicate(collectionId, viewId));
  invalidateQueries(databaseKeys.database(collectionId));
  return view;
}

export async function patchSchemaOps(
  collectionId: string,
  ops: SchemaOp[],
): Promise<PatchSchemaResult> {
  const result = await api.patch<PatchSchemaResult>(API_ROUTES.databaseSchema(collectionId), {
    ops,
  });
  invalidateQueries(['database', collectionId]);
  return result;
}

export function previewCast(
  collectionId: string,
  propertyId: string,
  toType: FieldType,
): Promise<CastPreview> {
  return api.post<CastPreview>(ROUTES.previewCast(collectionId), { propertyId, toType });
}

/** CSV 匯出：走 api.raw 才會帶 Authorization */
export async function downloadCsv(collectionId: string, viewId?: string | null): Promise<void> {
  const url = viewId ? `${ROUTES.exportCsv(collectionId)}?viewId=${viewId}` : ROUTES.exportCsv(collectionId);
  const res = await api.raw(url);
  if (!res.ok) throw new Error('匯出失敗');
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = `database-${collectionId}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
