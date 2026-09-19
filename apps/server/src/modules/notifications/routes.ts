import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import * as service from './service.js';

const listQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).default(30),
  before: z.string().uuid().optional(),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const subscriptionSchema = z.object({
  pageId: z.string().uuid(),
  kind: z.enum(['explicit', 'muted']),
});

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /** 收件匣。未讀數也一起回，側邊欄 badge 不必再打一支 API */
  app.get('/', async (req, reply) => {
    const user = requireUser(req);
    const { limit, before, unreadOnly } = listQuery.parse(req.query);
    return reply.send({
      data: await service.listInbox(user.id, {
        limit,
        before: before ?? null,
        unreadOnly,
      }),
    });
  });

  app.post('/:id/read', async (req, reply) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ data: await service.markRead(user.id, id) });
  });

  app.post('/read-all', async (req, reply) => {
    const user = requireUser(req);
    return reply.send({ data: await service.markAllRead(user.id) });
  });

  /** 頁面追蹤 / 取消追蹤（01 §6 M5.3.3） */
  app.post('/subscriptions', async (req, reply) => {
    const user = requireUser(req);
    const input = subscriptionSchema.parse(req.body);
    await service.setSubscription(user.id, input.pageId, input.kind);
    return reply.send({ data: { ok: true } });
  });
}
