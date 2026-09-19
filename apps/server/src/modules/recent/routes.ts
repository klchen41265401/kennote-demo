/**
 * 最近瀏覽 API。
 * `POST /api/pages/:id/visit` 的路徑屬於 pages，但邏輯屬於 recent，
 * 所以跟 history 模組一樣用完整路徑註冊（app.ts 不加 prefix）。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import { DEFAULT_RECENT_LIMIT, listRecentPages, recordPageVisit } from './service.js';

const pageParams = z.object({ id: z.string().uuid() });
const recentQuery = z.object({
  workspaceId: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(50).default(DEFAULT_RECENT_LIMIT),
});

export async function recentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post(
    '/api/pages/:id/visit',
    // 切頁很頻繁，但一人一頁只是一次 upsert；上限放寬但仍然要有
    { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = pageParams.parse(req.params);
      await recordPageVisit(id, user.id);
      return reply.status(204).send();
    },
  );

  app.get('/api/recent', async (req, reply) => {
    const user = requireUser(req);
    const { workspaceId, limit } = recentQuery.parse(req.query);
    return reply.send({ data: await listRecentPages(workspaceId, user.id, limit) });
  });
}
