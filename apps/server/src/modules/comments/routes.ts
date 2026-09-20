/**
 * 留言 API。路徑橫跨 /api/pages、/api/discussions、/api/comments 三個前綴，
 * 因此這個 plugin 直接註冊絕對路徑（app.ts 不加 prefix）。
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import * as service from './service.js';

const richText = z.array(z.record(z.unknown()));

const createDiscussionSchema = z.object({
  discussionId: z.string().uuid().optional(),
  blockId: z.string().uuid().nullable().optional(),
  anchor: z
    .union([
      z.object({ kind: z.literal('page') }),
      z.object({ kind: z.literal('inline'), quote: z.string().max(2000) }),
      z.object({ kind: z.literal('property'), property: z.string().max(64) }),
    ])
    .optional(),
  body: richText,
});

const bodySchema = z.object({ body: richText });
const writeLimit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

export async function commentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /** 一頁的所有討論串（右側 CommentsPanel 一次載完） */
  app.get('/api/pages/:id/discussions', async (req, reply) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ data: await service.listPageDiscussions(id, user.id) });
  });

  /**
   * 跨頁的最近討論串（gap-review C-8）：首頁按側邊欄「留言」時用。
   * 權限在 service 層逐頁再問一次。
   */
  app.get('/api/workspaces/:id/discussions', async (req, reply) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ data: await service.listWorkspaceDiscussions(id, user.id) });
  });

  /** 新討論串（頁面層級或 block 行內）。行內留言由前端先給 discussionId，與 comment mark 對齊 */
  app.post('/api/pages/:id/discussions', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = createDiscussionSchema.parse(req.body);
    const discussion = await service.createDiscussion(id, user.id, input as never);
    return reply.status(201).send({ data: discussion });
  });

  app.post('/api/discussions/:id/comments', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = bodySchema.parse(req.body);
    return reply.status(201).send({ data: await service.addComment(id, user.id, input as never) });
  });

  app.post('/api/discussions/:id/resolve', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ data: await service.setResolved(id, user.id, true) });
  });

  app.delete('/api/discussions/:id/resolve', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ data: await service.setResolved(id, user.id, false) });
  });

  app.patch('/api/comments/:id', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const input = bodySchema.parse(req.body);
    return reply.send({ data: await service.editComment(id, user.id, input.body as never) });
  });

  app.delete('/api/comments/:id', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return reply.send({ data: await service.deleteComment(id, user.id) });
  });
}
