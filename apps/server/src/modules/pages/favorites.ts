/**
 * 我的最愛 / 最近造訪（M3 App shell）。
 *
 * favorites 這張表在 0004_files_favorites.sql 就建好了，但一直沒有 API；
 * 側邊欄的「收藏」分區與 topbar 的星號需要它。
 * 「最近造訪」先用 pages.updated_at 近似（真正的 visit log 排在 M6 的 /api/recent）。
 */
import type { PageTreeNode } from '@kennote/shared-types';
import { db } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { buildPermissionIndex, filterTree } from '../permissions/bulk.js';
import { getMemberRole } from '../workspaces/repo.js';

interface TreeRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title_plain: string | null;
  icon: string | null;
  sort_key: string;
  is_database: boolean;
  has_children: boolean;
  updated_at: Date;
}

function toNode(r: TreeRow): PageTreeNode {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    parentId: r.parent_id,
    title: r.title_plain ?? '',
    icon: r.icon,
    sortKey: r.sort_key,
    isDatabase: r.is_database,
    hasChildren: r.has_children,
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function listFavorites(
  workspaceId: string,
  userId: string,
): Promise<PageTreeNode[]> {
  const rows = await db.query<TreeRow>(sql`
    SELECT p.id, p.workspace_id, p.parent_id, p.title_plain, p.icon, f.sort_key,
           p.is_database, p.updated_at,
           EXISTS (SELECT 1 FROM pages c WHERE c.parent_id = p.id AND c.deleted_at IS NULL)
             AS has_children
      FROM favorites f
      JOIN pages p ON p.id = f.page_id
     WHERE f.user_id = ${userId}
       AND f.workspace_id = ${workspaceId}
       AND p.deleted_at IS NULL
     ORDER BY f.sort_key ASC, f.created_at ASC
  `);
  // 第七輪：收藏也要過濾 —— 加入收藏之後權限被收回（或本來就是靠別的路徑拿到 id）
  // 的頁面不該還留在側邊欄上。
  return filterVisible(workspaceId, userId, rows.map(toNode));
}

/**
 * 共用的 per-page 權限過濾（第七輪，第六輪 §5-1）。
 * `filterTree` 會把看不見的節點拿掉；這兩份清單本來就是扁平的，
 * 所以 parentId 重新掛載不影響顯示。
 */
async function filterVisible(
  workspaceId: string,
  userId: string,
  nodes: PageTreeNode[],
): Promise<PageTreeNode[]> {
  const role = await getMemberRole(workspaceId, userId);
  if (!role) return [];
  const index = await buildPermissionIndex(workspaceId, userId, role);
  return filterTree(nodes, index);
}

export async function isFavorite(pageId: string, userId: string): Promise<boolean> {
  const row = await db.queryOne<{ ok: boolean }>(sql`
    SELECT true AS ok FROM favorites WHERE user_id = ${userId} AND page_id = ${pageId}
  `);
  return Boolean(row);
}

export async function addFavorite(
  pageId: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  await db.query(sql`
    INSERT INTO favorites (user_id, page_id, workspace_id)
    VALUES (${userId}, ${pageId}, ${workspaceId})
    ON CONFLICT (user_id, page_id) DO NOTHING
  `);
}

export async function removeFavorite(pageId: string, userId: string): Promise<void> {
  await db.query(sql`
    DELETE FROM favorites WHERE user_id = ${userId} AND page_id = ${pageId}
  `);
}

/** 最近造訪（近似：最近被更新的頁面，排除 database row） */
export async function listRecent(
  workspaceId: string,
  userId: string,
  limit = 10,
): Promise<PageTreeNode[]> {
  const rows = await db.query<TreeRow>(sql`
    SELECT p.id, p.workspace_id, p.parent_id, p.title_plain, p.icon, p.sort_key,
           p.is_database, p.updated_at,
           EXISTS (SELECT 1 FROM pages c WHERE c.parent_id = p.id AND c.deleted_at IS NULL)
             AS has_children
      FROM pages p
      JOIN workspace_members m
        ON m.workspace_id = p.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
     WHERE p.workspace_id = ${workspaceId}
       AND p.deleted_at IS NULL
     ORDER BY p.updated_at DESC
     LIMIT ${limit}
  `);
  return filterVisible(workspaceId, userId, rows.map(toNode));
}

/**
 * 「與我共用」（第六輪，第五輪 §4-3 的設計決定）。
 *
 * 工作區外的人也能被**頁面層級**授權（`resolvePermission()` 現在認得
 * 非成員的直接 `user` 條目，封頂 `edit`）。但 tree / search / trash 都是
 * 成員限定，所以他在側邊欄上什麼都看不到 —— 需要這一支把
 * 「別人指名分享給我、而我不是那個工作區的成員」的頁面列出來。
 *
 * 刻意只列 `subject_type = 'user'` 的**直接**條目（不展開繼承鏈）：
 * 那是「被分享的那一頁」的定義，子頁面照樣點得進去（`getPage` 的 fallback
 * 會沿繼承鏈解析），只是不佔側邊欄的位置。
 */
export async function listSharedWithMe(userId: string): Promise<PageTreeNode[]> {
  const rows = await db.query<TreeRow>(sql`
    SELECT p.id, p.workspace_id, p.parent_id, p.title_plain, p.icon, p.sort_key,
           p.is_database, p.updated_at,
           EXISTS (
             SELECT 1 FROM pages ch
              WHERE ch.parent_id = p.id AND ch.deleted_at IS NULL AND ch.collection_id IS NULL
           ) AS has_children
      FROM page_permissions pp
      JOIN pages p ON p.id = pp.page_id
     WHERE pp.subject_type = 'user'
       AND pp.subject_id = ${userId}
       AND pp.role <> 'none'
       AND p.deleted_at IS NULL
       AND p.collection_id IS NULL
       -- 已經是那個工作區的成員 → 頁面本來就在側邊欄的樹裡，不重複列
       AND NOT EXISTS (
             SELECT 1 FROM workspace_members m
              WHERE m.workspace_id = p.workspace_id
                AND m.user_id = ${userId}
                AND m.deleted_at IS NULL
           )
     ORDER BY p.updated_at DESC
     LIMIT 100
  `);
  return rows.map(toNode);
}
