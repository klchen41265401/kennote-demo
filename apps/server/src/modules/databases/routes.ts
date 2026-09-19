import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import * as service from './service.js';

const idParams = z.object({ id: z.string().uuid() });
const rowParams = z.object({ id: z.string().uuid(), rowId: z.string().uuid() });
const richText = z.array(z.record(z.unknown()));
const schemaShape = z.record(z.record(z.unknown()));
const writeLimit = { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };

export async function databaseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  app.post('/', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const input = z
      .object({
        workspaceId: z.string().uuid(),
        parentId: z.string().uuid().nullable().optional(),
        title: richText.optional(),
        schema: schemaShape.optional(),
      })
      .parse(req.body);
    return reply.status(201).send({ data: await service.createDatabase(input as never, user.id) });
  });

  app.get('/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    return reply.send({ data: await service.getDatabase(id, user.id) });
  });

  app.patch('/:id/schema', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const { schema } = z.object({ schema: schemaShape }).parse(req.body);
    return reply.send({ data: await service.patchSchema(id, user.id, schema as never) });
  });

  app.get('/:id/rows', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const query = z
      .object({
        viewId: z.string().uuid().optional(),
        limit: z.coerce.number().int().positive().max(200).optional(),
        offset: z.coerce.number().int().nonnegative().optional(),
      })
      .parse(req.query);
    return reply.send({ data: await service.queryRows(id, user.id, query) });
  });

  app.post('/:id/rows', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const input = z
      .object({ title: richText.optional(), properties: z.record(z.unknown()).optional() })
      .parse(req.body ?? {});
    return reply.status(201).send({ data: await service.createRow(id, user.id, input as never) });
  });

  app.patch('/:id/rows/:rowId', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id, rowId } = rowParams.parse(req.params);
    const input = z
      .object({
        title: richText.optional(),
        icon: z.string().max(64).nullable().optional(),
        properties: z.record(z.unknown()).optional(),
      })
      .parse(req.body ?? {});
    return reply.send({ data: await service.patchRow(id, rowId, user.id, input as never) });
  });

  app.post('/:id/views', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const input = z
      .object({
        type: z.enum(['table', 'board', 'list', 'gallery', 'calendar']),
        name: z.string().max(100).optional(),
        query: z.record(z.unknown()).optional(),
        format: z.record(z.unknown()).optional(),
      })
      .parse(req.body);
    return reply.status(201).send({ data: await service.createView(id, user.id, input as never) });
  });

  app.patch('/:id/views/:viewId', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const { viewId } = z.object({ viewId: z.string().uuid() }).parse(req.params);
    const input = z
      .object({
        name: z.string().max(100).optional(),
        type: z.enum(['table', 'board', 'list', 'gallery', 'calendar']).optional(),
        query: z.record(z.unknown()).optional(),
        format: z.record(z.unknown()).optional(),
        manualOrder: z.array(z.string().uuid()).optional(),
      })
      .parse(req.body ?? {});
    return reply.send({ data: await service.patchView(id, viewId, user.id, input as never) });
  });
}
