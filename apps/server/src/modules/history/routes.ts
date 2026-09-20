/** 版本歷史 API。路徑掛在 /api/pages 底下，但屬於 M5 的模組（app.ts 不加 prefix） */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import * as service from './service.js';
import { listUpdates } from './updates.js';

const pageParams = z.object({ id: z.string().uuid() });
const updatesQuery = z.object({ cursor: z.string().min(1).max(64).optional() });
const seqParams = z.object({
  id: z.string().uuid(),
  seq: z.coerce.number().int().nonnegative(),
});

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/pages/:id/history', async (req, reply) => {
    const user = requireUser(req);
    const { id } = pageParams.parse(req.params);
    return reply.send({ data: await service.listVersions(id, user.id) });
  });

  app.get('/api/pages/:id/history/:seq', async (req, reply) => {
    const user = requireUser(req);
    const { id, seq } = seqParams.parse(req.params);
    return reply.send({ data: await service.getSnapshotAt(id, user.id, seq) });
  });

  /**
   * 「更新」feed（活動摘要）—— 與 `/history`（快照清單）是兩個不同的東西。
   * gap-review B-5：側邊欄的「更新」按鈕以前打開的是版本歷史。
   */
  app.get('/api/pages/:id/updates', async (req, reply) => {
    const user = requireUser(req);
    const { id } = pageParams.parse(req.params);
    const { cursor } = updatesQuery.parse(req.query ?? {});
    return reply.send({ data: await listUpdates(id, user.id, cursor ?? null) });
  });

  app.post(
    '/api/pages/:id/history/:seq/restore',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const { id, seq } = seqParams.parse(req.params);
      return reply.send({ data: await service.restoreVersion(id, user.id, seq) });
    },
  );
}
