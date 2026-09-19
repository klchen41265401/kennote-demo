import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import { applyTransaction, listTransactionsSince } from '../blocks/apply-transaction.js';
import { findPageForUser } from './repo.js';
import {
  addFavorite,
  listFavorites,
  listRecent,
  removeFavorite,
  listSharedWithMe,
} from './favorites.js';
import { pageNotFound } from '../../lib/errors.js';
import * as service from './service.js';

const idParams = z.object({ id: z.string().uuid() });

const richText = z.array(z.record(z.unknown()));

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  title: richText.optional(),
  icon: z.string().max(64).nullable().optional(),
  afterId: z.string().uuid().nullable().optional(),
  isDatabase: z.boolean().optional(),
});

const patchSchema = z
  .object({
    title: richText.optional(),
    icon: z.string().max(64).nullable().optional(),
    cover: z.string().max(2000).nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: '沒有要更新的欄位' });

const moveSchema = z.object({
  parentId: z.string().uuid().nullable(),
  afterId: z.string().uuid().nullable().optional(),
});

const writeLimit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

export async function pageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /* ── 我的最愛 / 最近造訪（M3 App shell）────────────────
     注意：這兩條必須宣告在 '/:id' 之前也無妨 —— fastify 的 radix router
     一律讓靜態片段優先於參數片段，'/favorites' 不會被 '/:id' 吃掉。 */

  app.get('/favorites', async (req, reply) => {
    const user = requireUser(req);
    const { workspaceId } = z
      .object({ workspaceId: z.string().uuid() })
      .parse(req.query);
    return reply.send({ data: await listFavorites(workspaceId, user.id) });
  });

  /** 「與我共用」：別人指名分享給我、但我不是那個工作區成員的頁面（第六輪） */
  app.get('/shared-with-me', async (req, reply) => {
    const user = requireUser(req);
    return reply.send({ data: await listSharedWithMe(user.id) });
  });

  app.get('/recent', async (req, reply) => {
    const user = requireUser(req);
    const { workspaceId, limit } = z
      .object({
        workspaceId: z.string().uuid(),
        limit: z.coerce.number().int().positive().max(50).default(10),
      })
      .parse(req.query);
    return reply.send({ data: await listRecent(workspaceId, user.id, limit) });
  });

  app.post('/:id/favorite', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const page = await findPageForUser(id, user.id);
    if (!page) throw pageNotFound();
    await addFavorite(id, page.workspace_id, user.id);
    return reply.send({ data: { ok: true } });
  });

  app.delete('/:id/favorite', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    await removeFavorite(id, user.id);
    return reply.send({ data: { ok: true } });
  });

  app.post('/', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const input = createSchema.parse(req.body);
    const page = await service.createPage(input as never, user.id);
    return reply.status(201).send({ data: page });
  });

  app.get('/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    return reply.send({ data: await service.getPage(id, user.id) });
  });

  /** 初次載入：meta + 整頁 blocks（record_map 形狀，03 §9.1） */
  app.get('/:id/snapshot', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    return reply.send({ data: await service.getSnapshot(id, user.id) });
  });

  app.patch('/:id', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const patch = patchSchema.parse(req.body);
    return reply.send({ data: await service.patchPage(id, user.id, patch as never) });
  });

  app.delete('/:id', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    return reply.send({ data: await service.deletePage(id, user.id) });
  });

  app.post('/:id/restore', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    return reply.send({ data: await service.restorePage(id, user.id) });
  });

  app.delete('/:id/permanent', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    await service.permanentlyDeletePage(id, user.id);
    return reply.send({ data: { ok: true } });
  });

  app.post('/:id/move', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const input = moveSchema.parse(req.body);
    return reply.send({ data: await service.movePage(id, user.id, input) });
  });

  app.post('/:id/duplicate', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    return reply.status(201).send({ data: await service.duplicatePage(id, user.id) });
  });

  /* ── Block 變更的唯一入口（04 §5.4） ─────────────────── */

  app.post('/:id/transactions', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const { id } = idParams.parse(req.params);
      const result = await applyTransaction({ pageId: id, userId: user.id }, req.body);
      return reply.send({ data: result });
    });

  /** 斷線補傳 / 版本歷史 */
  app.get('/:id/transactions', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const { since, limit } = z
      .object({
        since: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().positive().max(500).default(200),
      })
      .parse(req.query);
    const page = await findPageForUser(id, user.id);
    if (!page) throw pageNotFound();
    const results = await listTransactionsSince(id, since, limit);
    return reply.send({ data: { pageId: id, seq: Number(page.seq), results } });
  });
}
