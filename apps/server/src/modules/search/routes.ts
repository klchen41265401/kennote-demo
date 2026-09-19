/**
 * 搜尋（自建，不引入外部搜尋服務 —— 00-README 決策 #8）。
 *
 * 階段一（現在）：pg_trgm + ILIKE 子字串比對。中文立刻可用，零 DB 端設定。
 * 階段二（M6）：應用層中文斷詞 → search_text → tsvector + ts_rank_cd，
 *              兩者共用同一張索引表，查詢介面不變。
 */
import type { FastifyInstance } from 'fastify';
import type { SearchHit } from '@kennote/shared-types';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { requireUser } from '../../plugins/auth.js';

const querySchema = z.object({
  q: z.string().min(1, '請輸入搜尋關鍵字').max(200),
  workspaceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async (req, reply) => {
    const user = requireUser(req);
    const { q, workspaceId, limit } = querySchema.parse(req.query);
    const pattern = `%${escapeLike(q)}%`;
    const wsFilter = workspaceId ? sql` AND p.workspace_id = ${workspaceId}` : sql.empty;

    const rows = await db.query<{
      page_id: string;
      block_id: string | null;
      workspace_id: string;
      title: string;
      snippet: string;
      icon: string | null;
      updated_at: Date;
      score: number;
    }>(sql`
      WITH accessible AS (
        SELECT p.id, p.workspace_id, p.title_plain, p.icon, p.updated_at
          FROM pages p
          JOIN workspace_members m
            ON m.workspace_id = p.workspace_id AND m.user_id = ${user.id} AND m.deleted_at IS NULL
         WHERE p.deleted_at IS NULL${wsFilter}
      ),
      page_hits AS (
        SELECT a.id AS page_id, NULL::uuid AS block_id, a.workspace_id,
               a.title_plain AS title, a.title_plain AS snippet, a.icon, a.updated_at,
               2.0 + similarity(a.title_plain, ${q}) AS score
          FROM accessible a
         WHERE a.title_plain ILIKE ${pattern}
      ),
      block_hits AS (
        SELECT a.id AS page_id, b.id AS block_id, a.workspace_id,
               a.title_plain AS title,
               left(b.plain_text, 300) AS snippet, a.icon, b.updated_at,
               1.0 + similarity(b.plain_text, ${q}) AS score
          FROM blocks b
          JOIN accessible a ON a.id = b.page_id
         WHERE b.deleted_at IS NULL AND b.plain_text ILIKE ${pattern}
      )
      SELECT * FROM (SELECT * FROM page_hits UNION ALL SELECT * FROM block_hits) hits
       ORDER BY score DESC, updated_at DESC
       LIMIT ${limit}
    `);

    const hits: SearchHit[] = rows.map((r) => ({
      pageId: r.page_id,
      blockId: r.block_id,
      workspaceId: r.workspace_id,
      title: r.title ?? '',
      snippet: r.snippet ?? '',
      icon: r.icon,
      updatedAt: r.updated_at.toISOString(),
      score: Number(r.score),
    }));

    return reply.send({ data: { query: q, hits } });
  });
}
