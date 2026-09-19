/**
 * 資料抓取的集中處。用自研的 useQuery（packages/ui）。
 * key 一律用陣列，serializeKey 會把它變成 'workspace/<id>/tree' 這種字串，
 * 因此 invalidateQueries('workspace') 可以一次清掉整個工作區的快取。
 */
import type {
  CreatePageRequest,
  FileMeta,
  Page,
  PageSnapshot,
  PageTreeNode,
  RichText,
  SessionInfo,
  TrashedPage,
} from '@kennote/shared-types';
import { API_ROUTES, COLLAB_API_ROUTES } from '@kennote/shared-types';
import { invalidateQueries, useQuery } from '@kennote/ui';
import { api } from './api-client';

export const queryKeys = {
  workspaceTree: (workspaceId: string) => ['workspace', workspaceId, 'tree'] as const,
  page: (pageId: string) => ['page', pageId] as const,
  snapshot: (pageId: string) => ['page', pageId, 'snapshot'] as const,
  trash: (workspaceId: string) => ['trash', workspaceId] as const,
};

export function useWorkspaceTree(workspaceId: string | null) {
  return useQuery<PageTreeNode[]>({
    key: workspaceId ? queryKeys.workspaceTree(workspaceId) : ['workspace', 'none', 'tree'],
    enabled: Boolean(workspaceId),
    fetcher: () => api.get<PageTreeNode[]>(API_ROUTES.workspaceTree(workspaceId!)),
  });
}

export function usePage(pageId: string | null) {
  return useQuery<Page>({
    key: pageId ? queryKeys.page(pageId) : ['page', 'none'],
    enabled: Boolean(pageId),
    fetcher: () => api.get<Page>(API_ROUTES.page(pageId!)),
  });
}

export function usePageSnapshot(pageId: string | null) {
  return useQuery<PageSnapshot>({
    key: pageId ? queryKeys.snapshot(pageId) : ['page', 'none', 'snapshot'],
    enabled: Boolean(pageId),
    fetcher: () => api.get<PageSnapshot>(API_ROUTES.pageSnapshot(pageId!)),
  });
}

export function useTrash(workspaceId: string | null) {
  return useQuery<TrashedPage[]>({
    key: workspaceId ? queryKeys.trash(workspaceId) : ['trash', 'none'],
    enabled: Boolean(workspaceId),
    fetcher: () => api.get<TrashedPage[]>(API_ROUTES.trash, { workspaceId: workspaceId! }),
  });
}

/* ── mutations ─────────────────────────────────────────── */

export async function createPage(input: CreatePageRequest): Promise<Page> {
  const page = await api.post<Page>(API_ROUTES.pages, input);
  invalidateQueries(['workspace', input.workspaceId]);
  return page;
}

export async function patchPageTitle(
  pageId: string,
  workspaceId: string,
  title: RichText,
): Promise<Page> {
  const page = await api.patch<Page>(API_ROUTES.page(pageId), { title });
  invalidateQueries(['workspace', workspaceId]);
  invalidateQueries(queryKeys.page(pageId));
  return page;
}

export async function deletePage(pageId: string, workspaceId: string): Promise<void> {
  await api.delete(API_ROUTES.page(pageId));
  invalidateQueries(['workspace', workspaceId]);
  invalidateQueries(['trash', workspaceId]);
}

export async function restorePage(pageId: string, workspaceId: string): Promise<void> {
  await api.post(API_ROUTES.pageRestore(pageId));
  invalidateQueries(['workspace', workspaceId]);
  invalidateQueries(['trash', workspaceId]);
}

/* ────────────────────────────────────────────────────────────
 * App shell（M3）追加的查詢與 mutation
 * ──────────────────────────────────────────────────────────── */

export const SHELL_ROUTES = {
  favorites: '/api/pages/favorites',
  pageFavorite: (id: string) => `/api/pages/${id}/favorite`,
  recent: '/api/recent',
  recentFallback: '/api/pages/recent',
  pagePermanent: (id: string) => `/api/pages/${id}/permanent`,
  workspace: (id: string) => `/api/workspaces/${id}`,
  workspaces: '/api/workspaces',
} as const;

/** 後端 /api/search 目前回 SearchHit[]；M6 之後會回 { hits: [...] }。兩種都吃。 */
export interface ShellSearchHit {
  pageId: string;
  blockId: string | null;
  title: string;
  snippet: string;
  icon: string | null;
  updatedAt: string;
  parentTitles?: string[];
}

function normalizeHits(raw: unknown): ShellSearchHit[] {
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { hits?: unknown } | null)?.hits ?? []);
  if (!Array.isArray(list)) return [];
  return list.map((h) => {
    const hit = h as Record<string, unknown>;
    return {
      pageId: String(hit.pageId ?? ''),
      blockId: (hit.blockId as string | null) ?? null,
      title: String(hit.title ?? ''),
      snippet: String(hit.snippet ?? ''),
      icon: (hit.icon as string | null) ?? null,
      updatedAt: String(hit.updatedAt ?? ''),
      ...(Array.isArray(hit.parentTitles) ? { parentTitles: hit.parentTitles as string[] } : {}),
    };
  });
}

export async function searchPages(
  q: string,
  workspaceId: string | null,
  options: { type?: string; limit?: number } = {},
): Promise<ShellSearchHit[]> {
  if (!q.trim()) return [];
  const raw = await api.get<unknown>(API_ROUTES.search, {
    q,
    ...(workspaceId ? { workspaceId } : {}),
    ...(options.type ? { type: options.type } : {}),
    limit: options.limit ?? 20,
  });
  return normalizeHits(raw);
}

/**
 * 最近造訪。三層 fallback：
 *   1. `/api/recent`（M6 代理會提供）
 *   2. `/api/pages/recent`（本模組加的）
 *   3. 從頁面樹依 updatedAt 排序推出來（後端還沒部署新版時畫面不會空白）
 */
export async function fetchRecent(workspaceId: string): Promise<PageTreeNode[]> {
  // 空陣列也往下一層找：/api/recent 在還沒有造訪紀錄時會回 []，
  // 但這個工作區明明有頁面，側邊欄的「最近」空著只會讓人以為壞了。
  try {
    const hits = await api.get<PageTreeNode[]>(SHELL_ROUTES.recent, { workspaceId });
    if (hits.length > 0) return hits;
  } catch {
    /* 換下一個 */
  }
  try {
    const hits = await api.get<PageTreeNode[]>(SHELL_ROUTES.recentFallback, { workspaceId });
    if (hits.length > 0) return hits;
  } catch {
    /* 換下一個 */
  }
  const tree = await api.get<PageTreeNode[]>(API_ROUTES.workspaceTree(workspaceId));
  return [...tree]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, 10);
}

export function useRecentPages(workspaceId: string | null) {
  return useQuery<PageTreeNode[]>({
    key: workspaceId ? (['recent', workspaceId] as const) : (['recent', 'none'] as const),
    enabled: Boolean(workspaceId),
    fetcher: () => fetchRecent(workspaceId!),
  });
}

export function useFavorites(workspaceId: string | null) {
  return useQuery<PageTreeNode[]>({
    key: workspaceId ? (['favorites', workspaceId] as const) : (['favorites', 'none'] as const),
    enabled: Boolean(workspaceId),
    fetcher: () =>
      api
        .get<PageTreeNode[]>(SHELL_ROUTES.favorites, { workspaceId: workspaceId! })
        // 後端還沒部署收藏 API 時當成「沒有收藏」，不要讓整個側邊欄爆掉
        .catch(() => [] as PageTreeNode[]),
  });
}

export async function setFavorite(
  pageId: string,
  workspaceId: string,
  favorite: boolean,
): Promise<void> {
  if (favorite) await api.post(SHELL_ROUTES.pageFavorite(pageId), {});
  else await api.delete(SHELL_ROUTES.pageFavorite(pageId));
  invalidateQueries(['favorites', workspaceId]);
}

export async function movePage(
  pageId: string,
  workspaceId: string,
  input: { parentId: string | null; afterId?: string | null },
): Promise<void> {
  await api.post(API_ROUTES.pageMove(pageId), input);
  invalidateQueries(['workspace', workspaceId]);
}

export async function duplicatePage(pageId: string, workspaceId: string): Promise<Page> {
  const res = await api.post<{ page: Page }>(API_ROUTES.pageDuplicate(pageId), {});
  invalidateQueries(['workspace', workspaceId]);
  return res.page;
}

export async function permanentlyDeletePage(pageId: string, workspaceId: string): Promise<void> {
  await api.delete(SHELL_ROUTES.pagePermanent(pageId));
  invalidateQueries(['trash', workspaceId]);
  invalidateQueries(['workspace', workspaceId]);
}

export async function patchPage(
  pageId: string,
  workspaceId: string,
  patch: { icon?: string | null; cover?: string | null; title?: RichText },
): Promise<Page> {
  const page = await api.patch<Page>(API_ROUTES.page(pageId), patch);
  invalidateQueries(['workspace', workspaceId]);
  invalidateQueries(queryKeys.page(pageId));
  return page;
}

/* ── 工作區 ─────────────────────────────────────────────── */

export function useWorkspaceMembers(workspaceId: string | null) {
  return useQuery<unknown[]>({
    key: workspaceId
      ? (['workspace', workspaceId, 'members'] as const)
      : (['workspace', 'none', 'members'] as const),
    enabled: Boolean(workspaceId),
    fetcher: () => api.get<unknown[]>(API_ROUTES.workspaceMembers(workspaceId!)),
  });
}

export async function patchWorkspace(
  workspaceId: string,
  patch: { name?: string; icon?: string | null; slug?: string },
): Promise<unknown> {
  const res = await api.patch<unknown>(SHELL_ROUTES.workspace(workspaceId), patch);
  invalidateQueries(['workspace', workspaceId]);
  return res;
}

export async function createWorkspace(name: string): Promise<{ id: string }> {
  return api.post<{ id: string }>(SHELL_ROUTES.workspaces, { name });
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await api.delete(SHELL_ROUTES.workspace(workspaceId));
}

/* ── 頁面權限（唯讀判定）──────────────────────────────────
   即時同步層的 `usePageSync().canEdit` 才是權威來源，但那需要 WS 連線；
   shell 只是要決定「要不要把編輯 UI 收起來」，用 REST 問一次就夠
   （後端仍然會拒絕無權限的寫入，這裡只是 UI 層的提示）。 */

export interface PagePermissionState {
  permission: string | null;
  canEdit: boolean | null;
}

export function usePagePermission(pageId: string | null): PagePermissionState {
  const q = useQuery<{ permission: string }>({
    key: pageId ? (['page', pageId, 'permissions'] as const) : (['page', 'none', 'permissions'] as const),
    enabled: Boolean(pageId),
    staleTime: 60_000,
    fetcher: () => api.get<{ permission: string }>(COLLAB_API_ROUTES.pageAccess(pageId!)),
  });
  const permission = q.data?.permission ?? null;
  return {
    permission,
    // 還沒問到之前回 null（＝不要搶著把編輯器變唯讀，避免閃爍）
    canEdit: permission === null ? null : permission === 'edit' || permission === 'full',
  };
}

/* ── 帳號設定（設定 Dialog 的「我的帳號」）───────────────── */

export const accountQueryKeys = {
  sessions: ['auth', 'sessions'] as const,
};

/** 登入中的裝置清單。一列 = 一次登入（一個 refresh token 家族） */
export function useSessions(enabled = true) {
  return useQuery<SessionInfo[]>({
    key: accountQueryKeys.sessions,
    enabled,
    staleTime: 15_000,
    fetcher: () => api.get<SessionInfo[]>(API_ROUTES.authSessions),
  });
}

export async function revokeSession(sessionId: string): Promise<void> {
  await api.delete(API_ROUTES.authSession(sessionId));
  invalidateQueries(accountQueryKeys.sessions);
}

/**
 * 頭像上傳：走既有的 POST /api/files/upload（需要 workspaceId，因為檔案掛在工作區底下），
 * 回來的 url 再 PATCH 到 /api/auth/me。這裡只負責上傳那一半，
 * 寫回帳號由 stores/auth 的 updateProfile 做（狀態要進 auth store）。
 */
export async function uploadAvatar(file: File, workspaceId: string): Promise<FileMeta> {
  const form = new FormData();
  form.append('workspaceId', workspaceId);
  form.append('file', file, file.name);
  return api.upload<FileMeta>(API_ROUTES.fileUpload, form);
}

/** 上傳前的本機檢查，省掉一次注定失敗的往返 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export function checkAvatarFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return '請選擇圖片檔';
  if (file.size > AVATAR_MAX_BYTES) return '圖片請小於 5 MB';
  return null;
}
