/**
 * 最近瀏覽。**這一層不認識 HTTP**（04 §7.3 鐵則 1）。
 */
import type { RecentPage, SearchResultType } from '@kennote/shared-types';
import { db } from '../../db/client.js';
import { pageNotFound, workspaceNotFound } from '../../lib/errors.js';
import { findPageForUser } from '../pages/repo.js';
import { getMemberRole } from '../workspaces/repo.js';
import { loadParentTitles } from '../search/ancestors.js';
import * as repo from './repo.js';

export const DEFAULT_RECENT_LIMIT = 10;
export const MAX_RECENT_LIMIT = 50;

export function resultTypeOf(row: {
  is_database: boolean;
  collection_id: string | null;
}): SearchResultType {
  // database 的容器頁 is_database=true（collection_id 也有值）；列則只有 collection_id
  if (row.is_database) return 'database';
  if (row.collection_id) return 'row';
  return 'page';
}

/** POST /api/pages/:id/visit —— 打開頁面時前端呼叫一次（fire and forget） */
export async function recordPageVisit(pageId: string, userId: string): Promise<void> {
  const page = await findPageForUser(pageId, userId);
  if (!page) throw pageNotFound();
  await repo.recordVisit(userId, pageId, page.workspace_id, db);
}

export async function listRecentPages(
  workspaceId: string,
  userId: string,
  limit = DEFAULT_RECENT_LIMIT,
): Promise<RecentPage[]> {
  if (!(await getMemberRole(workspaceId, userId))) throw workspaceNotFound();
  const capped = Math.min(Math.max(1, limit), MAX_RECENT_LIMIT);
  const rows = await repo.listRecent(userId, workspaceId, capped);
  const parents = await loadParentTitles(rows.map((r) => r.page_id));

  return rows.map((row) => ({
    pageId: row.page_id,
    workspaceId: row.workspace_id,
    title: row.title_plain && row.title_plain.length > 0 ? row.title_plain : '未命名',
    icon: row.icon,
    type: resultTypeOf(row),
    visitedAt: row.visited_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    parentTitles: parents.get(row.page_id) ?? [],
  }));
}
