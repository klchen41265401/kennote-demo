/**
 * 資料庫（collection / views / rows / schema / CSV 匯出）。
 *
 * 一列 = 一個 `pages` 列（與伺服器的 03 §4.5 相同），
 * `pages.properties` 是欄位值的真值，計算欄位在 `rows.ts` 物化時才產生。
 */
import type {
  CollectionSchema,
  CollectionView,
  DatabaseRow,
  FieldDefinition,
  RichText,
  RowProperties,
  SchemaOp,
  ViewFormat,
  ViewPropertyFormat,
  ViewQuery,
  ViewType,
} from '@kennote/shared-types';
import { FIELD_TYPE_META, FIELD_TYPES, VIEW_TYPES } from '@kennote/shared-types';
import { commit, db } from '../store';
import { createPage, currentUserId, getPage, livePages, softDeletePage } from '../core';
import { displayOf, materializeRow, runQuery } from '../rows';
import type { DemoHandler } from '../router';
import {
  DemoApiError,
  bySortKey,
  jsonOk,
  lastSortKey,
  noContent,
  nowIso,
  plain,
  shortId,
  sortKeyBetween,
  uuid,
} from '../util';

const DEFAULT_TITLE_WIDTH = 276;
const DEFAULT_PROPERTY_WIDTH = 200;

function defaultPropertyWidth(property: string): number {
  return property === 'title' ? DEFAULT_TITLE_WIDTH : DEFAULT_PROPERTY_WIDTH;
}

export function defaultSchema(): CollectionSchema {
  return {
    title: { name: '名稱', type: 'title' },
    Tags1: {
      name: '標籤',
      type: 'multiSelect',
      options: [
        { id: 'opt_design', value: '設計', color: 'purple' },
        { id: 'opt_dev', value: '開發', color: 'blue' },
      ],
    },
    Sta1: {
      name: '狀態',
      type: 'select',
      options: [
        { id: 'opt_todo', value: '未開始', color: 'gray' },
        { id: 'opt_doing', value: '進行中', color: 'blue' },
        { id: 'opt_done', value: '已完成', color: 'green' },
      ],
    },
    Due1: { name: '日期', type: 'date' },
  };
}

export function alignViewProperties(
  format: ViewFormat | undefined,
  schema: CollectionSchema,
): ViewPropertyFormat[] {
  const configured = format?.properties ?? [];
  const seen = new Set<string>();
  const out: ViewPropertyFormat[] = [];
  for (const entry of configured) {
    if (seen.has(entry.property) || !schema[entry.property]) continue;
    seen.add(entry.property);
    out.push(entry);
  }
  for (const property of Object.keys(schema)) {
    if (seen.has(property)) continue;
    seen.add(property);
    out.push({ property, visible: true, width: defaultPropertyWidth(property) });
  }
  return out;
}

function collectionOf(collectionId: string) {
  const collection = db().collections[collectionId];
  if (!collection) throw new DemoApiError(404, 'COLLECTION_NOT_FOUND', '找不到資料庫');
  return collection;
}

export function viewsOf(collectionId: string): CollectionView[] {
  return Object.values(db().views)
    .filter((v) => v.collectionId === collectionId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** collection 的所有列（= 載體頁底下的子頁） */
export function rowPagesOf(collectionId: string) {
  const collection = collectionOf(collectionId);
  return livePages(collection.workspaceId)
    .filter((p) => p.parentId === collection.pageId && !p.isDatabase)
    .sort(bySortKey);
}

export function rowsOf(collectionId: string, now = new Date()): DatabaseRow[] {
  const collection = collectionOf(collectionId);
  const schema = (collection.schema ?? {}) as CollectionSchema;
  return rowPagesOf(collectionId).map((page) =>
    materializeRow(page, collectionId, schema, { rowsOfCollection: (id) => (id === collectionId ? [] : rowsOf(id, now)) }, now),
  );
}

export interface CreateDatabaseOptions {
  workspaceId: string;
  parentId?: string | null;
  title?: RichText;
  schema?: CollectionSchema;
  inline?: boolean;
}

export function createDatabase(input: CreateDatabaseOptions) {
  const title = input.title ?? [{ text: '未命名資料庫' }];
  const page = createPage({
    workspaceId: input.workspaceId,
    parentId: input.parentId ?? null,
    title,
    isDatabase: true,
    seedParagraph: false,
  });
  const schema = input.schema ?? defaultSchema();
  const at = nowIso();
  const collection = {
    id: uuid(),
    workspaceId: input.workspaceId,
    pageId: page.id,
    name: title,
    description: [] as RichText,
    schema,
    isInline: input.inline ?? false,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  db().collections[collection.id] = collection;
  page.collectionId = collection.id;

  const view = insertView(collection.id, {
    type: 'table',
    name: '表格',
    format: { properties: alignViewProperties(undefined, schema), tableFreezeColumns: 1 },
  });
  commit();
  return { collection, views: [view] };
}

function insertView(
  collectionId: string,
  input: { type: ViewType; name?: string; query?: ViewQuery; format?: ViewFormat },
): CollectionView {
  const collection = collectionOf(collectionId);
  const schema = (collection.schema ?? {}) as CollectionSchema;
  const at = nowIso();
  const view: CollectionView = {
    id: uuid(),
    workspaceId: collection.workspaceId,
    collectionId,
    type: input.type,
    name: input.name ?? '新檢視',
    query: input.query ?? {},
    format: { ...(input.format ?? {}), properties: alignViewProperties(input.format, schema) },
    manualOrder: [],
    version: 1,
    createdAt: at,
    // createdAt 相同時用一個遞增的 updatedAt 保證視圖順序穩定
    updatedAt: at,
  };
  db().views[view.id] = view;
  commit();
  return view;
}

export function createRow(
  collectionId: string,
  input: { title?: RichText | string; properties?: RowProperties; group?: { property: string; key: string | null } },
) {
  const collection = collectionOf(collectionId);
  const schema = (collection.schema ?? {}) as CollectionSchema;
  const title: RichText = typeof input.title === 'string' ? [{ text: input.title }] : (input.title ?? []);
  const page = createPage({
    workspaceId: collection.workspaceId,
    parentId: collection.pageId,
    title,
  });
  const properties = normalizeRowProperties(schema, input.properties);
  // checkbox 預設 false（與伺服器一致）
  for (const [propertyId, def] of Object.entries(schema)) {
    if (def?.type === 'checkbox' && !properties[propertyId]) {
      properties[propertyId] = { type: 'checkbox', checkbox: false };
    }
  }
  // 看板「＋」直接落在某個泳道
  if (input.group && input.group.key !== null) {
    const def = schema[input.group.property];
    if (def?.type === 'select') properties[input.group.property] = { type: 'select', optionId: input.group.key };
    else if (def?.type === 'multiSelect') properties[input.group.property] = { type: 'multiSelect', optionIds: [input.group.key] };
    else if (def?.type === 'checkbox') properties[input.group.property] = { type: 'checkbox', checkbox: input.group.key === 'true' };
  }
  page.properties = properties as Record<string, unknown>;
  commit();
  return materializeRow(page, collectionId, schema);
}

export function normalizeRowProperties(
  schema: CollectionSchema,
  input: RowProperties | undefined,
  previous: RowProperties = {},
): RowProperties {
  const out: RowProperties = { ...previous };
  for (const [propertyId, raw] of Object.entries(input ?? {})) {
    const def = schema[propertyId];
    if (!def) continue;
    if (propertyId === 'title') continue; // title 的真值在 pages.title
    if (FIELD_TYPE_META[def.type]?.computed) continue; // 計算欄位寫入一律忽略
    if (raw === null || raw === undefined) {
      delete out[propertyId];
      continue;
    }
    out[propertyId] = raw;
  }
  return out;
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/* ── 路由 ────────────────────────────────────────────────── */

export const databaseRoutes: Array<[string, DemoHandler]> = [
  [
    'GET /api/databases/field-types',
    () =>
      jsonOk(
        FIELD_TYPES.map((type) => ({ type, ...FIELD_TYPE_META[type] })),
      ),
  ],
  [
    'GET /api/databases',
    (req) => {
      const workspaceId = req.query.get('workspaceId');
      return jsonOk(
        Object.values(db().collections)
          .filter((c) => !workspaceId || c.workspaceId === workspaceId)
          .filter((c) => !db().pages[c.pageId]?.deletedAt)
          .map((c) => ({ id: c.id, pageId: c.pageId, name: c.name, isInline: c.isInline })),
      );
    },
  ],
  [
    'POST /api/databases',
    async (req) => {
      const body = (await req.json<{
        workspaceId?: string;
        parentId?: string | null;
        parentPageId?: string | null;
        title?: RichText | string;
        schema?: CollectionSchema;
        inline?: boolean;
      }>()) ?? {};
      const workspaceId = body.workspaceId ?? Object.values(db().workspaces)[0]?.id;
      if (!workspaceId) throw new DemoApiError(404, 'WORKSPACE_NOT_FOUND', '找不到工作區');
      const title: RichText =
        typeof body.title === 'string' ? [{ text: body.title }] : (body.title ?? [{ text: '未命名資料庫' }]);
      return jsonOk(
        createDatabase({
          workspaceId,
          parentId: body.parentPageId ?? body.parentId ?? null,
          title,
          ...(body.schema ? { schema: body.schema } : {}),
          ...(body.inline !== undefined ? { inline: body.inline } : {}),
        }),
      );
    },
  ],
  [
    'GET /api/databases/:id',
    (req) => jsonOk({ collection: collectionOf(req.params.id!), views: viewsOf(req.params.id!) }),
  ],

  /* ── schema ──────────────────────────────────────── */
  [
    'PATCH /api/databases/:id/schema',
    async (req) => {
      const collectionId = req.params.id!;
      const collection = collectionOf(collectionId);
      const body = (await req.json<{ schema?: CollectionSchema; ops?: SchemaOp[] }>()) ?? {};
      const schema = { ...(collection.schema as CollectionSchema) };
      const migrations: Array<{ propertyId: string; scanned: number; converted: number; cleared: number }> = [];

      if (body.schema) {
        collection.schema = body.schema;
      } else {
        for (const op of body.ops ?? []) {
          switch (op.op) {
            case 'add': {
              const propertyId = op.propertyId ?? shortId('p');
              schema[propertyId] = op.definition;
              break;
            }
            case 'rename': {
              const def = schema[op.propertyId];
              if (def) schema[op.propertyId] = { ...def, name: op.name } as FieldDefinition;
              break;
            }
            case 'update':
              schema[op.propertyId] = op.definition;
              break;
            case 'retype': {
              schema[op.propertyId] = op.definition;
              // 型別換掉 → 舊值一律清空（demo 不做逐值轉換，和 preview-cast 的預告一致）
              let cleared = 0;
              for (const page of rowPagesOf(collectionId)) {
                const props = page.properties as RowProperties;
                if (props[op.propertyId]) {
                  delete props[op.propertyId];
                  cleared += 1;
                }
              }
              migrations.push({ propertyId: op.propertyId, scanned: rowPagesOf(collectionId).length, converted: 0, cleared });
              break;
            }
            case 'delete': {
              delete schema[op.propertyId];
              for (const page of rowPagesOf(collectionId)) {
                delete (page.properties as RowProperties)[op.propertyId];
              }
              break;
            }
            default:
              break;
          }
        }
        collection.schema = schema;
      }
      collection.version += 1;
      collection.updatedAt = nowIso();
      // 新欄位 append 到所有視圖
      for (const view of viewsOf(collectionId)) {
        view.format = { ...view.format, properties: alignViewProperties(view.format, collection.schema as CollectionSchema) };
      }
      commit();
      return jsonOk({ collection, migrations });
    },
  ],
  [
    'POST /api/databases/:id/schema/preview-cast',
    async (req) => {
      const collectionId = req.params.id!;
      const collection = collectionOf(collectionId);
      const schema = collection.schema as CollectionSchema;
      const body = (await req.json<{ propertyId?: string; toType?: string }>()) ?? {};
      const propertyId = body.propertyId ?? '';
      const def = schema[propertyId];
      const pages = rowPagesOf(collectionId);
      const affected = pages.filter((p) => (p.properties as RowProperties)[propertyId]).length;
      return jsonOk({
        propertyId,
        fromType: def?.type ?? 'text',
        toType: body.toType ?? 'text',
        affected,
        convertible: 0,
        lossy: affected,
        samples: pages
          .slice(0, 5)
          .map((p) => displayOf((p.properties as RowProperties)[propertyId], def))
          .filter(Boolean),
      });
    },
  ],

  /* ── rows ─────────────────────────────────────────── */
  [
    'GET /api/databases/:id/rows',
    (req) => {
      const collectionId = req.params.id!;
      const collection = collectionOf(collectionId);
      const schema = (collection.schema ?? {}) as CollectionSchema;
      const viewId = req.query.get('viewId');
      const view = viewId ? db().views[viewId] : null;
      if (viewId && !view) throw new DemoApiError(404, 'VIEW_NOT_FOUND', '找不到視圖');
      const limit = Math.min(Number(req.query.get('limit') ?? 50) || 50, 200);
      const offset = Number(req.query.get('cursor') ?? 0) || 0;
      const search = req.query.get('search') ?? '';

      const result = runQuery({
        schema,
        query: view?.query ?? {},
        rows: rowsOf(collectionId),
        limit,
        offset,
        search,
      });
      return jsonOk({
        collectionId,
        viewId: view?.id ?? null,
        rows: result.rows,
        ...(result.groups ? { groups: result.groups } : {}),
        aggregations: result.aggregations,
        cursor: result.hasMore ? String(result.nextOffset) : null,
        hasMore: result.hasMore,
        total: result.total,
      });
    },
  ],
  [
    'POST /api/databases/:id/rows',
    async (req) => {
      const body = (await req.json<{
        title?: RichText | string;
        properties?: RowProperties;
        group?: { property: string; key: string | null };
      }>()) ?? {};
      return jsonOk(createRow(req.params.id!, body));
    },
  ],
  [
    'POST /api/databases/:id/rows/reorder',
    async (req) => {
      const collectionId = req.params.id!;
      const body = (await req.json<{ rowId?: string; afterId?: string | null }>()) ?? {};
      const page = getPage(body.rowId ?? '');
      const siblings = rowPagesOf(collectionId).filter((p) => p.id !== page.id);
      if (!body.afterId) {
        page.sortKey = sortKeyBetween(null, siblings[0]?.sortKey ?? null);
      } else {
        const idx = siblings.findIndex((p) => p.id === body.afterId);
        page.sortKey = sortKeyBetween(siblings[idx]?.sortKey ?? null, siblings[idx + 1]?.sortKey ?? null);
      }
      commit();
      const collection = collectionOf(collectionId);
      return jsonOk(materializeRow(page, collectionId, collection.schema as CollectionSchema));
    },
  ],
  [
    'PATCH /api/databases/:id/rows/:rowId',
    async (req) => {
      const collectionId = req.params.id!;
      const collection = collectionOf(collectionId);
      const schema = (collection.schema ?? {}) as CollectionSchema;
      const page = getPage(req.params.rowId!);
      const body = (await req.json<{
        title?: RichText | string;
        icon?: string | null;
        cover?: string | null;
        properties?: RowProperties;
      }>()) ?? {};
      const titleValue = body.properties?.title;
      if (body.title !== undefined) {
        page.title = typeof body.title === 'string' ? [{ text: body.title }] : body.title;
      } else if (titleValue && (titleValue.type === 'title' || titleValue.type === 'text')) {
        page.title = titleValue.richText;
      }
      if (body.icon !== undefined) page.icon = body.icon;
      if (body.cover !== undefined) page.cover = body.cover;
      if (body.properties) {
        page.properties = normalizeRowProperties(
          schema,
          body.properties,
          page.properties as RowProperties,
        ) as Record<string, unknown>;
      }
      page.updatedAt = nowIso();
      page.updatedBy = currentUserId();
      commit();
      return jsonOk(materializeRow(page, collectionId, schema));
    },
  ],
  [
    'DELETE /api/databases/:id/rows/:rowId',
    (req) => {
      getPage(req.params.rowId!);
      softDeletePage(req.params.rowId!);
      return noContent();
    },
  ],
  [
    'POST /api/databases/:id/rows/:rowId/duplicate',
    (req) => {
      const collectionId = req.params.id!;
      const collection = collectionOf(collectionId);
      const source = getPage(req.params.rowId!);
      const copy = createPage({
        workspaceId: collection.workspaceId,
        parentId: collection.pageId,
        title: source.title,
      });
      copy.properties = JSON.parse(JSON.stringify(source.properties ?? {}));
      copy.icon = source.icon;
      copy.cover = source.cover;
      copy.sortKey = lastSortKey(rowPagesOf(collectionId).map((p) => p.sortKey));
      commit();
      return jsonOk(materializeRow(copy, collectionId, collection.schema as CollectionSchema));
    },
  ],

  /* ── views ────────────────────────────────────────── */
  [
    'POST /api/databases/:id/views',
    async (req) => {
      const body = (await req.json<{ type?: ViewType; name?: string; query?: ViewQuery; format?: ViewFormat }>()) ?? {};
      const type = body.type ?? 'table';
      if (!(VIEW_TYPES as readonly string[]).includes(type)) {
        throw new DemoApiError(400, 'VALIDATION_FAILED', `不支援的視圖型別：${type}`);
      }
      return jsonOk(
        insertView(req.params.id!, {
          type,
          ...(body.name ? { name: body.name } : {}),
          ...(body.query ? { query: body.query } : {}),
          ...(body.format ? { format: body.format } : {}),
        }),
      );
    },
  ],
  [
    'PATCH /api/databases/:id/views/:viewId',
    async (req) => {
      const view = db().views[req.params.viewId!];
      if (!view) throw new DemoApiError(404, 'VIEW_NOT_FOUND', '找不到視圖');
      const collection = collectionOf(req.params.id!);
      const patch = (await req.json<Partial<CollectionView>>()) ?? {};
      if (patch.name !== undefined) view.name = patch.name;
      if (patch.type !== undefined) view.type = patch.type;
      if (patch.query !== undefined) view.query = patch.query;
      if (patch.format !== undefined) {
        view.format = {
          ...view.format,
          ...patch.format,
          properties: alignViewProperties(
            { ...view.format, ...patch.format },
            collection.schema as CollectionSchema,
          ),
        };
      }
      if (patch.manualOrder !== undefined) view.manualOrder = patch.manualOrder;
      view.version += 1;
      view.updatedAt = nowIso();
      commit();
      return jsonOk(view);
    },
  ],
  [
    'DELETE /api/databases/:id/views/:viewId',
    (req) => {
      delete db().views[req.params.viewId!];
      commit();
      return noContent();
    },
  ],
  [
    'POST /api/databases/:id/views/:viewId/duplicate',
    (req) => {
      const source = db().views[req.params.viewId!];
      if (!source) throw new DemoApiError(404, 'VIEW_NOT_FOUND', '找不到視圖');
      return jsonOk(
        insertView(req.params.id!, {
          type: source.type,
          name: `${source.name} 複本`,
          query: JSON.parse(JSON.stringify(source.query)),
          format: JSON.parse(JSON.stringify(source.format)),
        }),
      );
    },
  ],

  /* ── CSV 匯出 ─────────────────────────────────────── */
  [
    'GET /api/databases/:id/export.csv',
    (req) => {
      const collectionId = req.params.id!;
      const collection = collectionOf(collectionId);
      const schema = (collection.schema ?? {}) as CollectionSchema;
      const viewId = req.query.get('viewId');
      const view = viewId ? db().views[viewId] : null;
      const columns = (view?.format.properties ?? alignViewProperties(undefined, schema))
        .filter((p) => p.visible !== false && schema[p.property])
        .map((p) => p.property);
      const result = runQuery({ schema, query: view?.query ?? {}, rows: rowsOf(collectionId), limit: 10_000, offset: 0 });
      const header = columns.map((id) => csvEscape(schema[id]?.name ?? id)).join(',');
      const lines = result.rows.map((row) =>
        columns
          .map((id) => csvEscape(id === 'title' ? plain(row.title) : displayOf(row.properties[id], schema[id])))
          .join(','),
      );
      // Excel 友善的 BOM
      const csv = `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${plain(collection.name) || 'database'}.csv"`,
        },
      });
    },
  ],
];
