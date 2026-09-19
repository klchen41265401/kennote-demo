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
  return rows.map(toNode);
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
  return rows.map(toNode);
}
