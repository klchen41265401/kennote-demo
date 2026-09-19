import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { workspaceNotFound } from '../../lib/errors.js';
import { requireUser } from '../../plugins/auth.js';
import { db } from '../../db/client.js';
import { sql, type Sql } from '../../db/sql.js';
import { getMemberRole, getWorkspaceTree, listMembers, listWorkspacesForUser } from './repo.js';

const idParams = z.object({ id: z.string().uuid() });

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.get('/', async (req, reply) => {
    const user = requireUser(req);
    return reply.send({ data: await listWorkspacesForUser(user.id) });
  });

  /** 側邊欄頁面樹：回扁平陣列 + parentId + sortKey，前端自己組樹（04 §8 M3） */
  app.get('/:id/tree', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const role = await getMemberRole(id, user.id);
    if (!role) throw workspaceNotFound();
    return reply.send({ data: await getWorkspaceTree(id, user.id, role) });
  });

  /* ── 工作區設定（M3 App shell）────────────────────────
     只有 owner / admin 能改名稱、icon、slug；刪除只允許 owner。 */

  app.post('/', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    const { name, icon } = z
      .object({ name: z.string().min(1).max(100), icon: z.string().max(64).nullable().optional() })
      .parse(req.body);
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'ws'}-${Math.random().toString(36).slice(2, 8)}`;
    const row = await db.queryOne<{ id: string }>(sql`
      INSERT INTO workspaces (name, slug, icon, owner_id)
      VALUES (${name}, ${slug}, ${icon ?? null}, ${user.id})
      RETURNING id
    `);
    if (!row) throw workspaceNotFound();
    await db.query(sql`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${row.id}, ${user.id}, 'owner')
      ON CONFLICT DO NOTHING
    `);
    return reply.status(201).send({ data: { id: row.id, name, slug, icon: icon ?? null, role: 'owner' } });
  });

  app.patch('/:id', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const role = await getMemberRole(id, user.id);
    if (!role) throw workspaceNotFound();
    if (role !== 'owner' && role !== 'admin') throw workspaceNotFound();
    const patch = z
      .object({
        name: z.string().min(1).max(100).optional(),
        icon: z.string().max(64).nullable().optional(),
        slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/).optional(),
      })
      .refine((p) => Object.keys(p).length > 0, { message: '沒有要更新的欄位' })
      .parse(req.body);

    const sets: Sql[] = [];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.icon !== undefined) sets.push(sql`icon = ${patch.icon}`);
    if (patch.slug !== undefined) sets.push(sql`slug = ${patch.slug}`);
    const assignment = sql.join(sets, ', ');
    const row = await db.queryOne<{ id: string; name: string; slug: string; icon: string | null }>(sql`
      UPDATE workspaces SET ${assignment}, updated_at = now()
       WHERE id = ${id} AND deleted_at IS NULL
       RETURNING id, name, slug, icon
    `);
    if (!row) throw workspaceNotFound();
    return reply.send({ data: { ...row, role } });
  });

  app.delete('/:id', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const role = await getMemberRole(id, user.id);
    if (role !== 'owner') throw workspaceNotFound();
    await db.query(sql`UPDATE workspaces SET deleted_at = now() WHERE id = ${id}`);
    return reply.send({ data: { ok: true } });
  });

  app.get('/:id/members', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    if (!(await getMemberRole(id, user.id))) throw workspaceNotFound();
    return reply.send({ data: await listMembers(id) });
  });
}
