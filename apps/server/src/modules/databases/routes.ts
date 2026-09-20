import type { FastifyInstance } from 'fastify';
import { FIELD_TYPES, OPEN_PAGE_IN_VALUES, VIEW_TYPES } from '@kennote/shared-types';
import { z } from 'zod';
import { requireUser } from '../../plugins/auth.js';
import * as service from './service.js';

const idParams = z.object({ id: z.string().uuid() });
const rowParams = z.object({ id: z.string().uuid(), rowId: z.string().uuid() });
const viewParams = z.object({ id: z.string().uuid(), viewId: z.string().uuid() });
const richText = z.array(z.record(z.unknown()));
const schemaShape = z.record(z.record(z.unknown()));
const propertiesShape = z.record(z.unknown());
const writeLimit = { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } };

/** 標題允許直接給字串（'待辦事項'）或 RichText */
const titleInput = z.union([z.string().max(2000), richText]).optional();

function toRichText(value: unknown) {
  if (typeof value === 'string') return value === '' ? [] : [{ text: value }];
  return value;
}

export async function databaseRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  /** 前端 field registry 的對照表（型別選單、運算子清單都讀這個） */
  app.get('/field-types', async (_req, reply) =>
    reply.send({ data: service.describeFieldTypes() }),
  );

  app.post('/', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const input = z
      .object({
        workspaceId: z.string().uuid(),
        // parentPageId 是 M4 的命名，parentId 保留給既有呼叫端
        parentId: z.string().uuid().nullable().optional(),
        parentPageId: z.string().uuid().nullable().optional(),
        title: titleInput,
        schema: schemaShape.optional(),
        inline: z.boolean().optional(),
      })
      .parse(req.body);

    const data = await service.createDatabase(
      {
        workspaceId: input.workspaceId,
        parentId: input.parentPageId ?? input.parentId ?? null,
        ...(input.title !== undefined ? { title: toRichText(input.title) as never } : {}),
        ...(input.schema !== undefined ? { schema: input.schema as never } : {}),
        ...(input.inline !== undefined ? { inline: input.inline } : {}),
      },
      user.id,
    );
    return reply.status(201).send({ data });
  });

  /**
   * 工作區裡的資料庫清單（relation 欄位的「目標資料庫」下拉用，
   * 使用者不必自己貼 collection 的 UUID）。
   */
  app.get('/', async (req, reply) => {
    const user = requireUser(req);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.query);
    return reply.send({ data: await service.listDatabases(workspaceId, user.id) });
  });

  app.get('/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    return reply.send({ data: await service.getDatabase(id, user.id) });
  });

  /* ── schema ─────────────────────────────────────────── */

  const schemaOp = z.discriminatedUnion('op', [
    z.object({
      op: z.literal('add'),
      propertyId: z.string().max(16).optional(),
      definition: z.record(z.unknown()),
      /** relation：順便在目標資料庫建一個反向欄位（Notion 的「在〈目標〉顯示」） */
      createDual: z.object({ name: z.string().min(1).max(200) }).optional(),
    }),
    z.object({ op: z.literal('rename'), propertyId: z.string().max(16), name: z.string().min(1).max(200) }),
    z.object({
      op: z.literal('update'),
      propertyId: z.string().max(16),
      definition: z.record(z.unknown()),
      createDual: z.object({ name: z.string().min(1).max(200) }).optional(),
    }),
    z.object({ op: z.literal('retype'), propertyId: z.string().max(16), definition: z.record(z.unknown()) }),
    z.object({ op: z.literal('delete'), propertyId: z.string().max(16) }),
  ]);

  app.patch('/:id/schema', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const body = z
      .object({ schema: schemaShape.optional(), ops: z.array(schemaOp).max(50).optional() })
      .parse(req.body ?? {});

    if (body.ops && body.ops.length > 0) {
      return reply.send({ data: await service.applySchemaOps(id, user.id, body.ops as never) });
    }
    if (!body.schema) {
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: '請提供 schema 或 ops' },
      });
    }
    const collection = await service.patchSchema(id, user.id, body.schema as never);
    return reply.send({ data: { collection, migrations: [] } });
  });

  /** 型別切換前的預告：「將影響 N 筆、其中 M 筆無法轉換」（02 §4.3.1 必做） */
  app.post('/:id/schema/preview-cast', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const { propertyId, toType } = z
      .object({ propertyId: z.string().max(16), toType: z.enum(FIELD_TYPES) })
      .parse(req.body);
    return reply.send({ data: await service.previewCast(id, user.id, propertyId, toType) });
  });

  /* ── rows ───────────────────────────────────────────── */

  app.get('/:id/rows', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const query = z
      .object({
        viewId: z.string().uuid().optional(),
        limit: z.coerce.number().int().positive().max(200).optional(),
        offset: z.coerce.number().int().nonnegative().optional(),
        cursor: z.string().max(4000).optional(),
        search: z.string().max(200).optional(),
        timeZone: z.string().max(60).optional(),
      })
      .parse(req.query);
    return reply.send({ data: await service.queryRows(id, user.id, query) });
  });

  app.post('/:id/rows', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const input = z
      .object({
        title: titleInput,
        properties: propertiesShape.optional(),
        group: z
          .object({ property: z.string().max(16), key: z.string().max(80).nullable() })
          .optional(),
      })
      .parse(req.body ?? {});
    const data = await service.createRow(id, user.id, {
      ...(input.title !== undefined ? { title: toRichText(input.title) as never } : {}),
      ...(input.properties !== undefined ? { properties: input.properties as never } : {}),
      ...(input.group !== undefined ? { group: input.group } : {}),
    });
    return reply.status(201).send({ data });
  });

  app.patch('/:id/rows/:rowId', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id, rowId } = rowParams.parse(req.params);
    const input = z
      .object({
        title: titleInput,
        icon: z.string().max(64).nullable().optional(),
        cover: z.string().max(2000).nullable().optional(),
        properties: propertiesShape.optional(),
      })
      .parse(req.body ?? {});
    const data = await service.patchRow(id, rowId, user.id, {
      ...(input.title !== undefined ? { title: toRichText(input.title) as never } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.cover !== undefined ? { cover: input.cover } : {}),
      ...(input.properties !== undefined ? { properties: input.properties as never } : {}),
    });
    return reply.send({ data });
  });

  app.delete('/:id/rows/:rowId', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id, rowId } = rowParams.parse(req.params);
    await service.deleteRow(id, rowId, user.id);
    return reply.status(204).send();
  });

  /**
   * 表格的拖曳排序。`afterId: null` = 移到最前面；省略 = 移到最後面。
   * （`PATCH /rows/:id` 只改屬性，排序是另一件事，所以給它自己的端點。）
   */
  app.post('/:id/rows/reorder', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const input = z
      .object({ rowId: z.string().uuid(), afterId: z.string().uuid().nullable() })
      .parse(req.body);
    return reply.send({ data: await service.reorderRow(id, input.rowId, user.id, input.afterId) });
  });

  app.post('/:id/rows/:rowId/duplicate', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id, rowId } = rowParams.parse(req.params);
    return reply.status(201).send({ data: await service.duplicateRow(id, rowId, user.id) });
  });

  /* ── views ──────────────────────────────────────────── */

  /**
   * `view.format` 是 jsonb（不需要 migration），歷來都是整包 passthrough。
   * 這裡只把**會被程式讀的列舉欄位**明確驗起來：`openPageIn`（頁面打開方式，
   * 側邊預覽 / 置中預覽 / 完整頁面）。其餘欄位維持原本的 passthrough 行為。
   */
  const viewFormatInput = z
    .object({ openPageIn: z.enum(OPEN_PAGE_IN_VALUES).optional() })
    .passthrough();


  app.post('/:id/views', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const input = z
      .object({
        type: z.enum(VIEW_TYPES),
        name: z.string().max(100).optional(),
        query: z.record(z.unknown()).optional(),
        format: viewFormatInput.optional(),
      })
      .parse(req.body);
    return reply.status(201).send({ data: await service.createView(id, user.id, input as never) });
  });

  app.patch('/:id/views/:viewId', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id, viewId } = viewParams.parse(req.params);
    const input = z
      .object({
        name: z.string().max(100).optional(),
        type: z.enum(VIEW_TYPES).optional(),
        query: z.record(z.unknown()).optional(),
        format: viewFormatInput.optional(),
        manualOrder: z.array(z.string().uuid()).max(5000).optional(),
      })
      .parse(req.body ?? {});
    return reply.send({ data: await service.patchView(id, viewId, user.id, input as never) });
  });

  app.delete('/:id/views/:viewId', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id, viewId } = viewParams.parse(req.params);
    await service.deleteView(id, viewId, user.id);
    return reply.status(204).send();
  });

  app.post('/:id/views/:viewId/duplicate', writeLimit, async (req, reply) => {
    const user = requireUser(req);
    const { id, viewId } = viewParams.parse(req.params);
    return reply.status(201).send({ data: await service.duplicateView(id, viewId, user.id) });
  });

  /* ── 匯出 ───────────────────────────────────────────── */

  app.get('/:id/export.csv', async (req, reply) => {
    const user = requireUser(req);
    const { id } = idParams.parse(req.params);
    const { viewId } = z.object({ viewId: z.string().uuid().optional() }).parse(req.query);
    const csv = await service.exportCsv(id, user.id, viewId);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="database-${id}.csv"`)
      .send(csv);
  });
}
