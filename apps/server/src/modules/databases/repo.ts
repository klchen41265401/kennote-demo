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

/* ── collections ───────────────────────────────────────── */

export interface CollectionRow {
  id: string;
  workspace_id: string;
  page_id: string;
  parent_block_id: string | null;
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
  'id, workspace_id, page_id, parent_block_id, name, description, schema, is_inline, version, created_at, updated_at',
);

function collectionColumns(prefix: string): Sql {
  return sql.raw(
    [
      'id',
      'workspace_id',
      'page_id',
      'parent_block_id',
      'name',
      'description',
      'schema',
      'is_inline',
      'version',
      'created_at',
      'updated_at',
    ]
      .map((c) => `${prefix}.${c}`)
      .join(', '),
  );
}

export async function insertCollection(
  conn: Queryable,
  input: {
    workspaceId: string;
    pageId: string;
    parentBlockId?: string | null;
    name: RichText;
    schema: CollectionSchema;
    isInline?: boolean;
    createdBy: string;
  },
): Promise<CollectionRow> {
  const row = await conn.queryOne<CollectionRow>(sql`
    INSERT INTO collections (workspace_id, page_id, parent_block_id, name, schema, is_inline, created_by)
    VALUES (${input.workspaceId}, ${input.pageId}, ${input.parentBlockId ?? null},
            ${JSON.stringify(input.name)}::jsonb, ${JSON.stringify(input.schema)}::jsonb,
            ${input.isInline ?? false}, ${input.createdBy})
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
    SELECT ${collectionColumns('c')}
      FROM collections c
      JOIN workspace_members m
        ON m.workspace_id = c.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
     WHERE c.id = ${collectionId} AND c.deleted_at IS NULL
  `);
}

export async function findCollectionById(
  collectionId: string,
  conn: Queryable = db,
): Promise<CollectionRow | null> {
  return conn.queryOne<CollectionRow>(sql`
    SELECT ${COLLECTION_COLUMNS} FROM collections
     WHERE id = ${collectionId} AND deleted_at IS NULL
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

export async function updateCollectionMeta(
  conn: Queryable,
  collectionId: string,
  patch: { name?: RichText; description?: RichText; isInline?: boolean },
): Promise<CollectionRow | null> {
  const sets: Sql[] = [];
  if (patch.name !== undefined) sets.push(sql`name = ${JSON.stringify(patch.name)}::jsonb`);
  if (patch.description !== undefined) {
    sets.push(sql`description = ${JSON.stringify(patch.description)}::jsonb`);
  }
  if (patch.isInline !== undefined) sets.push(sql`is_inline = ${patch.isInline}`);
  if (sets.length === 0) return findCollectionById(collectionId, conn);
  return conn.queryOne<CollectionRow>(sql`
    UPDATE collections SET ${sql.join(sets, ', ')}
     WHERE id = ${collectionId} AND deleted_at IS NULL
     RETURNING ${COLLECTION_COLUMNS}
  `);
}

/* ── views ─────────────────────────────────────────────── */

export interface ViewRow {
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
     ORDER BY sort_order ASC, created_at ASC
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
    sortOrder?: number;
  },
): Promise<ViewRow | null> {
  const sets: Sql[] = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.type !== undefined) sets.push(sql`type = ${patch.type}::collection_view_type`);
  if (patch.query !== undefined) sets.push(sql`query = ${JSON.stringify(patch.query)}::jsonb`);
  if (patch.format !== undefined) sets.push(sql`format = ${JSON.stringify(patch.format)}::jsonb`);
  if (patch.manualOrder !== undefined) sets.push(sql`manual_order = ${patch.manualOrder}::uuid[]`);
  if (patch.sortOrder !== undefined) sets.push(sql`sort_order = ${patch.sortOrder}`);
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

export async function softDeleteView(
  conn: Queryable,
  viewId: string,
  collectionId: string,
): Promise<boolean> {
  const row = await conn.queryOne<{ id: string }>(sql`
    UPDATE collection_views SET deleted_at = now()
     WHERE id = ${viewId} AND collection_id = ${collectionId} AND deleted_at IS NULL
     RETURNING id
  `);
  return row !== null;
}

export async function countViews(collectionId: string, conn: Queryable = db): Promise<number> {
  const row = await conn.queryOne<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM collection_views
     WHERE collection_id = ${collectionId} AND deleted_at IS NULL
  `);
  return row?.count ?? 0;
}

/* ── rows（= pages 的一列） ─────────────────────────────── */

export interface RowRecord {
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
  /** buildOrderSql 產生的排序鍵（sk0, sk1…），cursor 用 */
  [extra: string]: unknown;
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

const ROW_COLUMNS = sql.raw(
  [
    'p.id',
    'p.collection_id',
    'p.title',
    'p.icon',
    'p.cover',
    'p.properties',
    'p.created_at',
    'p.updated_at',
    'p.created_by',
    'p.updated_by',
  ].join(', '),
);

export interface QueryRowsOptions {
  where: Sql | null;
  order: Sql;
  /** 排序鍵的 SELECT 片段（`, (expr)::text AS sk0…`） */
  sortKeys: Sql;
  limit: number;
}

export async function queryRows(
  collectionId: string,
  opts: QueryRowsOptions,
  conn: Queryable = db,
): Promise<RowRecord[]> {
  const whereExtra = opts.where ? sql` AND ${opts.where}` : sql.empty;
  return conn.query<RowRecord>(sql`
    SELECT ${ROW_COLUMNS}${opts.sortKeys}
      FROM pages p
     WHERE p.collection_id = ${collectionId} AND p.is_database = FALSE AND p.deleted_at IS NULL${whereExtra}
     ORDER BY ${opts.order}
     LIMIT ${opts.limit}
  `);
}

export async function countRows(
  collectionId: string,
  where: Sql | null,
  conn: Queryable = db,
): Promise<number> {
  const whereExtra = where ? sql` AND ${where}` : sql.empty;
  const row = await conn.queryOne<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM pages p
     WHERE p.collection_id = ${collectionId} AND p.is_database = FALSE AND p.deleted_at IS NULL${whereExtra}
  `);
  return row?.count ?? 0;
}

export interface GroupedRowRecord extends RowRecord {
  group_key: string | null;
  group_total: number;
}

/**
 * 分組查詢（看板泳道）。一次取回每組前 N 張卡 + 每組總數，
 * 不做 N 個查詢（03 §7.3 的 window function 寫法）。
 */
export async function queryGroupedRows(
  collectionId: string,
  opts: QueryRowsOptions & { groupKey: Sql; perGroup: number },
  conn: Queryable = db,
): Promise<GroupedRowRecord[]> {
  const whereExtra = opts.where ? sql` AND ${opts.where}` : sql.empty;
  return conn.query<GroupedRowRecord>(sql`
    WITH ranked AS (
      SELECT ${ROW_COLUMNS}${opts.sortKeys},
             ${opts.groupKey} AS group_key,
             row_number() OVER (PARTITION BY ${opts.groupKey} ORDER BY ${opts.order}) AS rn,
             count(*)     OVER (PARTITION BY ${opts.groupKey})::int AS group_total
        FROM pages p
       WHERE p.collection_id = ${collectionId} AND p.is_database = FALSE AND p.deleted_at IS NULL${whereExtra}
    )
    SELECT * FROM ranked WHERE rn <= ${opts.perGroup}
  `);
}

/** 聚合列：一次查一排 agg 值（別名 a0, a1…） */
export async function queryAggregations(
  collectionId: string,
  where: Sql | null,
  selects: Sql[],
  conn: Queryable = db,
): Promise<Record<string, string | null>> {
  if (selects.length === 0) return {};
  const whereExtra = where ? sql` AND ${where}` : sql.empty;
  const row = await conn.queryOne<Record<string, string | null>>(sql`
    SELECT ${sql.join(selects, ', ')}
      FROM pages p
     WHERE p.collection_id = ${collectionId} AND p.is_database = FALSE AND p.deleted_at IS NULL${whereExtra}
  `);
  return row ?? {};
}

export async function findRow(
  rowId: string,
  collectionId: string,
  conn: Queryable = db,
): Promise<RowRecord | null> {
  return conn.queryOne<RowRecord>(sql`
    SELECT ${ROW_COLUMNS}
      FROM pages p
     WHERE p.id = ${rowId} AND p.collection_id = ${collectionId} AND p.deleted_at IS NULL
  `);
}

/** rollup 用：一次撈回目標 collection 的多列 */
export async function findRowsByIds(
  rowIds: string[],
  conn: Queryable = db,
): Promise<RowRecord[]> {
  if (rowIds.length === 0) return [];
  return conn.query<RowRecord>(sql`
    SELECT ${ROW_COLUMNS}
      FROM pages p
     WHERE p.id = ANY(${rowIds}::uuid[]) AND p.deleted_at IS NULL
  `);
}

export async function updateRowProperties(
  conn: Queryable,
  rowId: string,
  patch: { title?: RichText; icon?: string | null; cover?: string | null; properties?: RowProperties },
  actorId: string,
): Promise<RowRecord | null> {
  const sets: Sql[] = [sql`updated_by = ${actorId}`, sql`version = version + 1`];
  if (patch.title !== undefined) sets.push(sql`title = ${JSON.stringify(patch.title)}::jsonb`);
  if (patch.icon !== undefined) sets.push(sql`icon = ${patch.icon}`);
  if (patch.cover !== undefined) sets.push(sql`cover = ${patch.cover}`);
  if (patch.properties !== undefined) {
    sets.push(sql`properties = ${JSON.stringify(patch.properties)}::jsonb`);
  }
  return conn.queryOne<RowRecord>(sql`
    UPDATE pages p SET ${sql.join(sets, ', ')}
     WHERE p.id = ${rowId} AND p.deleted_at IS NULL
     RETURNING ${ROW_COLUMNS}
  `);
}

export async function softDeleteRow(
  conn: Queryable,
  rowId: string,
  collectionId: string,
): Promise<boolean> {
  const row = await conn.queryOne<{ id: string }>(sql`
    UPDATE pages SET deleted_at = now()
     WHERE id = ${rowId} AND collection_id = ${collectionId} AND deleted_at IS NULL
     RETURNING id
  `);
  return row !== null;
}

/** 整個 collection 的列（CSV 匯出、schema 型別遷移用）。上限由呼叫端決定 */
export async function streamAllRows(
  collectionId: string,
  where: Sql | null,
  order: Sql,
  limit: number,
  conn: Queryable = db,
): Promise<RowRecord[]> {
  const whereExtra = where ? sql` AND ${where}` : sql.empty;
  return conn.query<RowRecord>(sql`
    SELECT ${ROW_COLUMNS}
      FROM pages p
     WHERE p.collection_id = ${collectionId} AND p.is_database = FALSE AND p.deleted_at IS NULL${whereExtra}
     ORDER BY ${order}
     LIMIT ${limit}
  `);
}

/* ── relation 的邊表（03 §4.8 / migration 0006） ────────── */

export interface RelationEdge {
  from_row_id: string;
  from_property: string;
  to_row_id: string;
  to_property: string | null;
  position: number;
}

/** 重建某一列某個 relation 欄位的所有邊（真值是 properties，這裡只是投影） */
export async function replaceRelationEdges(
  conn: Queryable,
  input: {
    workspaceId: string;
    fromRowId: string;
    fromProperty: string;
    toProperty: string | null;
    toRowIds: string[];
  },
): Promise<void> {
  await conn.query(sql`
    DELETE FROM row_relations
     WHERE from_row_id = ${input.fromRowId} AND from_property = ${input.fromProperty}
  `);
  if (input.toRowIds.length === 0) return;
  const values = input.toRowIds.map(
    (id, i) => sql`(${input.workspaceId}, ${input.fromRowId}, ${input.fromProperty},
                    ${id}, ${input.toProperty}, ${i})`,
  );
  await conn.query(sql`
    INSERT INTO row_relations (workspace_id, from_row_id, from_property, to_row_id, to_property, position)
    VALUES ${sql.join(values, ', ')}
    ON CONFLICT (from_row_id, from_property, to_row_id) DO NOTHING
  `);
}

export async function listRelationEdgesTo(
  toRowId: string,
  toProperty: string,
  conn: Queryable = db,
): Promise<RelationEdge[]> {
  return conn.query<RelationEdge>(sql`
    SELECT from_row_id, from_property, to_row_id, to_property, position
      FROM row_relations
     WHERE to_row_id = ${toRowId} AND to_property = ${toProperty}
     ORDER BY position
  `);
}

/** 目標列上的反向欄位值（雙向同步用）：一次取多列 */
export async function findRowsForRelationUpdate(
  rowIds: string[],
  conn: Queryable,
): Promise<Array<{ id: string; collection_id: string | null; properties: RowProperties }>> {
  if (rowIds.length === 0) return [];
  return conn.query<{ id: string; collection_id: string | null; properties: RowProperties }>(sql`
    SELECT id, collection_id, properties FROM pages
     WHERE id = ANY(${rowIds}::uuid[]) AND deleted_at IS NULL
     FOR UPDATE
  `);
}

export async function setRowPropertiesRaw(
  conn: Queryable,
  rowId: string,
  properties: RowProperties,
): Promise<void> {
  await conn.query(sql`
    UPDATE pages SET properties = ${JSON.stringify(properties)}::jsonb, version = version + 1
     WHERE id = ${rowId}
  `);
}
