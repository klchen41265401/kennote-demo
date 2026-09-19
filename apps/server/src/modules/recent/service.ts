/**
 * 最近瀏覽。**這一層不認識 HTTP**（04 §7.3 鐵則 1）。
 */
import type { RecentPage, SearchResultType } from '@kennote/shared-types';
import { db } from '../../db/client.js';
import { pageNotFound, workspaceNotFound } from '../../lib/errors.js';
import { findPageInUserWorkspace } from '../pages/repo.js';
import { buildPermissionIndex, canSee } from '../permissions/bulk.js';
import { resolvePagePermission } from '../permissions/service.js';
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
  // 第七輪：沒有讀取權限的頁面不該進「最近瀏覽」（BUG-35 之前 guest 讀得到任何頁面，
  // 連帶把標題留在自己的 recent 裡；讀取補上守門員之後這裡也一起收緊）
  if ((await resolvePagePermission(userId, pageId)) === 'none') throw pageNotFound();
  const page = await findPageInUserWorkspace(pageId, userId);
  if (!page) throw pageNotFound();
  await repo.recordVisit(userId, pageId, page.workspace_id, db);
}

export async function listRecentPages(
  workspaceId: string,
  userId: string,
  limit = DEFAULT_RECENT_LIMIT,
): Promise<RecentPage[]> {
  const role = await getMemberRole(workspaceId, userId);
  if (!role) throw workspaceNotFound();
  const capped = Math.min(Math.max(1, limit), MAX_RECENT_LIMIT);
  const all = await repo.listRecent(userId, workspaceId, capped);
  // 第七輪：`page_visits` 是「我去過哪裡」的流水帳，權限之後可能被收回
  // （或當初根本是靠別人貼網址進去的）→ 列出來之前要重新問一次。
  const index = await buildPermissionIndex(workspaceId, userId, role);
  const rows = all.filter((r) => canSee(index, r.page_id));
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
