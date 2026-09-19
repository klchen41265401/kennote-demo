import type {
  Collection,
  CollectionSchema,
  CollectionView,
  DatabaseRow,
  RichText,
  RowProperties,
  ViewFormat,
  ViewQuery,
  ViewType,
} from '@kennote/shared-types';
import { db, type Queryable } from '../../db/client.js';
import { sql, type Sql } from '../../db/sql.js';

interface CollectionRow {
  id: string;
  workspace_id: string;
  page_id: string;
  name: RichText;
  description: RichText;
  schema: CollectionSchema;
  is_inline: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export function toCollection(r: CollectionRow): Collection {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    pageId: r.page_id,
    name: r.name ?? [],
    description: r.description ?? [],
    schema: r.schema ?? {},
    isInline: r.is_inline,
    version: Number(r.version),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const COLLECTION_COLUMNS = sql.raw(
  'id, workspace_id, page_id, name, description, schema, is_inline, version, created_at, updated_at',
);

export async function insertCollection(
  conn: Queryable,
  input: {
    workspaceId: string;
    pageId: string;
    name: RichText;
    schema: CollectionSchema;
    createdBy: string;
  },
): Promise<CollectionRow> {
  const row = await conn.queryOne<CollectionRow>(sql`
    INSERT INTO collections (workspace_id, page_id, name, schema, created_by)
    VALUES (${input.workspaceId}, ${input.pageId}, ${JSON.stringify(input.name)}::jsonb,
            ${JSON.stringify(input.schema)}::jsonb, ${input.createdBy})
    RETURNING ${COLLECTION_COLUMNS}
  `);
  if (!row) throw new Error('建立 collection 失敗');
  return row;
}

/** 取 collection 並同時驗證存取權（非成員 → null → 呼叫端回 404） */
export async function findCollectionForUser(
  collectionId: string,
  userId: string,
  conn: Queryable = db,
): Promise<CollectionRow | null> {
  return conn.queryOne<CollectionRow>(sql`
    SELECT c.id, c.workspace_id, c.page_id, c.name, c.description, c.schema,
           c.is_inline, c.version, c.created_at, c.updated_at
      FROM collections c
      JOIN workspace_members m
        ON m.workspace_id = c.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
     WHERE c.id = ${collectionId} AND c.deleted_at IS NULL
  `);
}

export async function updateCollectionSchema(
  conn: Queryable,
  collectionId: string,
  schema: CollectionSchema,
): Promise<CollectionRow | null> {
  return conn.queryOne<CollectionRow>(sql`
    UPDATE collections SET schema = ${JSON.stringify(schema)}::jsonb
     WHERE id = ${collectionId} AND deleted_at IS NULL
     RETURNING ${COLLECTION_COLUMNS}
  `);
}

/* ── views ─────────────────────────────────────────────── */

interface ViewRow {
  id: string;
  workspace_id: string;
  collection_id: string;
  type: ViewType;
  name: string;
  query: ViewQuery;
  format: ViewFormat;
  manual_order: string[];
  version: number;
  created_at: Date;
  updated_at: Date;
}

const VIEW_COLUMNS = sql.raw(
  'id, workspace_id, collection_id, type, name, query, format, manual_order, version, created_at, updated_at',
);

export function toView(r: ViewRow): CollectionView {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    collectionId: r.collection_id,
    type: r.type,
    name: r.name,
    query: r.query ?? {},
    format: r.format ?? {},
    manualOrder: r.manual_order ?? [],
    version: Number(r.version),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export async function insertView(
  conn: Queryable,
  input: {
    workspaceId: string;
    collectionId: string;
    type: ViewType;
    name: string;
    query: ViewQuery;
    format: ViewFormat;
    createdBy: string;
  },
): Promise<ViewRow> {
  const row = await conn.queryOne<ViewRow>(sql`
    INSERT INTO collection_views (workspace_id, collection_id, type, name, query, format,
                                  sort_order, created_by)
    VALUES (${input.workspaceId}, ${input.collectionId}, ${input.type}, ${input.name},
            ${JSON.stringify(input.query)}::jsonb, ${JSON.stringify(input.format)}::jsonb,
            (SELECT coalesce(max(sort_order), -1) + 1 FROM collection_views
              WHERE collection_id = ${input.collectionId}),
            ${input.createdBy})
    RETURNING ${VIEW_COLUMNS}
  `);
  if (!row) throw new Error('建立視圖失敗');
  return row;
}

export async function listViews(collectionId: string, conn: Queryable = db): Promise<ViewRow[]> {
  return conn.query<ViewRow>(sql`
    SELECT ${VIEW_COLUMNS} FROM collection_views
     WHERE collection_id = ${collectionId} AND deleted_at IS NULL
     ORDER BY sort_order ASC
  `);
}

export async function findView(
  viewId: string,
  collectionId: string,
  conn: Queryable = db,
): Promise<ViewRow | null> {
  return conn.queryOne<ViewRow>(sql`
    SELECT ${VIEW_COLUMNS} FROM collection_views
     WHERE id = ${viewId} AND collection_id = ${collectionId} AND deleted_at IS NULL
  `);
}

export async function updateView(
  conn: Queryable,
  viewId: string,
  patch: {
    name?: string;
    type?: ViewType;
    query?: ViewQuery;
    format?: ViewFormat;
    manualOrder?: string[];
  },
): Promise<ViewRow | null> {
  const sets: Sql[] = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.type !== undefined) sets.push(sql`type = ${patch.type}::collection_view_type`);
  if (patch.query !== undefined) sets.push(sql`query = ${JSON.stringify(patch.query)}::jsonb`);
  if (patch.format !== undefined) sets.push(sql`format = ${JSON.stringify(patch.format)}::jsonb`);
  if (patch.manualOrder !== undefined)
    sets.push(sql`manual_order = ${patch.manualOrder}::uuid[]`);
  if (sets.length === 0) return findViewById(viewId, conn);
  return conn.queryOne<ViewRow>(sql`
    UPDATE collection_views SET ${sql.join(sets, ', ')}
     WHERE id = ${viewId} AND deleted_at IS NULL
     RETURNING ${VIEW_COLUMNS}
  `);
}

async function findViewById(viewId: string, conn: Queryable = db): Promise<ViewRow | null> {
  return conn.queryOne<ViewRow>(sql`
    SELECT ${VIEW_COLUMNS} FROM collection_views WHERE id = ${viewId} AND deleted_at IS NULL
  `);
}

/* ── rows（= pages 的一列） ─────────────────────────────── */

interface RowRecord {
  id: string;
  collection_id: string;
  title: RichText;
  icon: string | null;
  cover: string | null;
  properties: RowProperties;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

export function toRow(r: RowRecord): DatabaseRow {
  return {
    id: r.id,
    collectionId: r.collection_id,
    title: r.title ?? [],
    icon: r.icon,
    cover: r.cover,
    properties: (r.properties ?? {}) as RowProperties,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    createdBy: r.created_by,
    updatedBy: r.updated_by,
  };
}

export async function queryRows(
  collectionId: string,
  opts: { where: Sql | null; order: Sql; limit: number; offset: number },
): Promise<{ rows: RowRecord[]; total: number }> {
  const whereExtra = opts.where ? sql` AND ${opts.where}` : sql.empty;
  const rows = await db.query<RowRecord>(sql`
    SELECT p.id, p.collection_id, p.title, p.icon, p.cover, p.properties,
           p.created_at, p.updated_at, p.created_by, p.updated_by
      FROM pages p
     WHERE p.collection_id = ${collectionId} AND p.deleted_at IS NULL${whereExtra}
     ORDER BY ${opts.order}
     LIMIT ${opts.limit} OFFSET ${opts.offset}
  `);
  const totalRow = await db.queryOne<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM pages p
     WHERE p.collection_id = ${collectionId} AND p.deleted_at IS NULL${whereExtra}
  `);
  return { rows, total: totalRow?.count ?? rows.length };
}

export async function findRow(
  rowId: string,
  collectionId: string,
  conn: Queryable = db,
): Promise<RowRecord | null> {
  return conn.queryOne<RowRecord>(sql`
    SELECT p.id, p.collection_id, p.title, p.icon, p.cover, p.properties,
           p.created_at, p.updated_at, p.created_by, p.updated_by
      FROM pages p
     WHERE p.id = ${rowId} AND p.collection_id = ${collectionId} AND p.deleted_at IS NULL
  `);
}

export async function updateRowProperties(
  conn: Queryable,
  rowId: string,
  patch: { title?: RichText; icon?: string | null; properties?: RowProperties },
  actorId: string,
): Promise<RowRecord | null> {
  const sets: Sql[] = [sql`updated_by = ${actorId}`, sql`version = version + 1`];
  if (patch.title !== undefined) sets.push(sql`title = ${JSON.stringify(patch.title)}::jsonb`);
  if (patch.icon !== undefined) sets.push(sql`icon = ${patch.icon}`);
  if (patch.properties !== undefined)
    sets.push(sql`properties = ${JSON.stringify(patch.properties)}::jsonb`);
  return conn.queryOne<RowRecord>(sql`
    UPDATE pages SET ${sql.join(sets, ', ')}
     WHERE id = ${rowId} AND deleted_at IS NULL
     RETURNING id, collection_id, title, icon, cover, properties,
               created_at, updated_at, created_by, updated_by
  `);
}
