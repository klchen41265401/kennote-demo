/**
 * 手動觸發 GC。只有工作區 owner 可以呼叫（01 §9 M8.1.3 的排程任務也走同一支）。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import { requireWorkspaceRole } from '../permissions/service.js';
import { DEFAULT_RETENTION_DAYS, getLastGcResult, runGarbageCollection } from './service.js';

const bodySchema = z.object({
  workspaceId: z.string().uuid(),
  retentionDays: z.coerce.number().int().min(1).max(3650).default(DEFAULT_RETENTION_DAYS),
  dryRun: z.boolean().default(false),
});

export async function gcRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post(
    '/api/admin/gc',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const body = bodySchema.parse(req.body ?? {});
      // GC 是全域動作，但要有「某個工作區的 owner」身分才准跑
      await requireWorkspaceRole(body.workspaceId, user.id, ['owner']);
      const result = await runGarbageCollection({
        retentionDays: body.retentionDays,
        dryRun: body.dryRun,
      });
      return reply.send({ data: result });
    },
  );

  app.get('/api/admin/gc', async (req, reply) => {
    const user = requireUser(req);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.query);
    await requireWorkspaceRole(workspaceId, user.id, ['owner']);
    return reply.send({ data: { last: getLastGcResult() } });
  });
}
