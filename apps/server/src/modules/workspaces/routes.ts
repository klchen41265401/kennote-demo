import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { workspaceNotFound } from '../../lib/errors.js';
import { requireUser } from '../../plugins/auth.js';
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
    if (!(await getMemberRole(id, user.id))) throw workspaceNotFound();
    return reply.send({ data: await getWorkspaceTree(id) });
  });

  app.get('/:id/members', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    if (!(await getMemberRole(id, user.id))) throw workspaceNotFound();
    return reply.send({ data: await listMembers(id) });
  });
}
