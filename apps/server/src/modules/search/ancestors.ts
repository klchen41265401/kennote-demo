/**
 * 搜尋結果的麵包屑：一次把多個頁面的祖先標題撈回來。
 *
 * 為什麼要獨立：搜尋結果與「最近瀏覽」都要顯示「工程筆記 / 2026 / 這一頁」，
 * 而 N 個結果各跑一次遞迴查詢就是 N+1。這裡用一支遞迴 CTE 一次解決。
 */
import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';

const MAX_DEPTH = 20;

/**
 * @returns pageId → 祖先標題（由遠到近，不含自己）
 */
export async function loadParentTitles(
  pageIds: string[],
  conn: Queryable = db,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (pageIds.length === 0) return result;

  const rows = await conn.query<{ root: string; depth: number; title_plain: string | null }>(sql`
    WITH RECURSIVE up AS (
      SELECT p.id AS root, p.id, p.parent_id, p.title_plain, 0 AS depth
        FROM pages p
       WHERE p.id = ANY(${pageIds}::uuid[])
      UNION ALL
      SELECT u.root, p.id, p.parent_id, p.title_plain, u.depth + 1
        FROM pages p
        JOIN up u ON p.id = u.parent_id
       WHERE u.depth < ${MAX_DEPTH}
    )
    SELECT root, depth, title_plain FROM up
     WHERE depth > 0
     ORDER BY root, depth DESC
  `);

  for (const id of pageIds) result.set(id, []);
  for (const row of rows) {
    const list = result.get(row.root);
    if (!list) continue;
    list.push(row.title_plain && row.title_plain.length > 0 ? row.title_plain : '未命名');
  }
  return result;
}
