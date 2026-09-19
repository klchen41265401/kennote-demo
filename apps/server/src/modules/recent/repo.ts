import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';

export interface RecentRow {
  page_id: string;
  workspace_id: string;
  title_plain: string | null;
  icon: string | null;
  is_database: boolean;
  collection_id: string | null;
  visited_at: Date;
  updated_at: Date;
}

/** upsert：同一人同一頁只留一列，重看就更新時間與次數 */
export async function recordVisit(
  userId: string,
  pageId: string,
  workspaceId: string,
  conn: Queryable = db,
): Promise<void> {
  await conn.query(sql`
    INSERT INTO page_visits (user_id, page_id, workspace_id, visit_count, visited_at)
    VALUES (${userId}, ${pageId}, ${workspaceId}, 1, now())
    ON CONFLICT (user_id, page_id) DO UPDATE
      SET visit_count = page_visits.visit_count + 1,
          visited_at  = now(),
          workspace_id = EXCLUDED.workspace_id
  `);
}

/**
 * 最近瀏覽。刻意**不 fallback 到「最近編輯」**：
 * 兩者語意不同（別人編輯的頁面不該出現在我的最近瀏覽），
 * 要「最近編輯」的地方請用 workspace tree 的 updatedAt 排序。
 */
export async function listRecent(
  userId: string,
  workspaceId: string,
  limit: number,
  conn: Queryable = db,
): Promise<RecentRow[]> {
  return conn.query<RecentRow>(sql`
    SELECT v.page_id, v.workspace_id, p.title_plain, p.icon, p.is_database,
           p.collection_id, v.visited_at, p.updated_at
      FROM page_visits v
      JOIN pages p ON p.id = v.page_id AND p.deleted_at IS NULL
      JOIN workspace_members m
        ON m.workspace_id = p.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
     WHERE v.user_id = ${userId} AND v.workspace_id = ${workspaceId}
     ORDER BY v.visited_at DESC
     LIMIT ${limit}
  `);
}

/** GC：頁面被永久刪除時 page_visits 會被 FK cascade 清掉，這裡只處理「太舊」 */
export async function pruneVisits(olderThanDays: number, conn: Queryable = db): Promise<number> {
  const rows = await conn.query<{ id: string }>(sql`
    DELETE FROM page_visits
     WHERE visited_at < now() - (${olderThanDays} || ' days')::interval
     RETURNING page_id AS id
  `);
  return rows.length;
}
