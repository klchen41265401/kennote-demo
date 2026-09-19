/**
 * 搜尋（自建，不引入外部搜尋服務 —— 00-README 決策 #8）。
 *
 * 階段一（M1）：pg_trgm + ILIKE 子字串比對。
 * 階段二（M6，現在）：應用層中文斷詞 → tsvector + ts_rank_cd 相關性排序，
 *                    trgm 留作短查詢 / 錯字 / 零結果的 fallback。
 * 查詢介面（GET /api/search）在兩個階段之間**沒有 breaking change**，
 * 只是多了 type / createdBy / updatedAfter / cursor 幾個可選參數。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import { DEFAULT_LIMIT, search } from './service.js';

const querySchema = z.object({
  // 空字串是合法的：代表「還沒打字」，回最近瀏覽
  q: z.string().max(200).default(''),
  workspaceId: z.string().uuid().optional(),
  type: z.enum(['page', 'database']).optional(),
  createdBy: z.string().uuid().optional(),
  updatedAfter: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(50).default(DEFAULT_LIMIT),
  cursor: z.string().max(200).optional(),
});

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async (req, reply) => {
    const user = requireUser(req);
    const input = querySchema.parse(req.query);
    return reply.send({ data: await search(input, user.id) });
  });
}
