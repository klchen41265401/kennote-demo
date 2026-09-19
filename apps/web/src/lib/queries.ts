/**
 * 資料抓取的集中處。用自研的 useQuery（packages/ui）。
 * key 一律用陣列，serializeKey 會把它變成 'workspace/<id>/tree' 這種字串，
 * 因此 invalidateQueries('workspace') 可以一次清掉整個工作區的快取。
 */
import type {
  CreatePageRequest,
  Page,
  PageSnapshot,
  PageTreeNode,
  RichText,
  TrashedPage,
} from '@kennote/shared-types';
import { API_ROUTES } from '@kennote/shared-types';
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
