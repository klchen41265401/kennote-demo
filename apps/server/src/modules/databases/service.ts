/**
 * Database 系統的應用層（M4）。
 *
 * 分層紀律（04 §5.2）：service 不碰 req/reply，SQL 一律在 repo / query-builder。
 * 這一支只負責「規則」：權限、schema 驗證與遷移、計算欄位、分組與分頁組裝、
 * relation 的雙向維護。
 */
import type {
  AggregationFunction,
  AggregationResult,
  CastPreview,
  Collection,
  CollectionSchema,
  CollectionView,
  CreateViewRequest,
  DatabaseRow,
  DatabaseSnapshot,
  FieldDefinition,
  FieldType,
  FieldValue,
  PatchSchemaResult,
  PatchViewRequest,
  QueryRowsResult,
  RichText,
  RowGroup,
  RowProperties,
  SchemaMigrationReport,
  SchemaOp,
  SelectOption,
  ViewQuery,
} from '@kennote/shared-types';
import { findSchemaFormulaCycles, richTextToPlainText } from '@kennote/shared-types';
import { db, withTransaction, type Queryable } from '../../db/client.js';
import { sql, type Sql } from '../../db/sql.js';
import { AppError, pageNotFound, workspaceNotFound } from '../../lib/errors.js';
import { getMemberRole } from '../workspaces/repo.js';
import * as pagesRepo from '../pages/repo.js';
import {
  computeRowProperties,
  schemaHasComputed,
  schemaRelationProperties,
  type RollupSource,
  type RollupSources,
} from './computed.js';
import {
  generateOptionId,
  generatePropertyId,
  getFieldType,
  listFieldTypes,
} from './field-types/index.js';
import { MEMORY_SCAN_LIMIT, matchesFilter, sortInMemory } from './memory-filter.js';
import {
  buildAggregationSql,
  buildCursorSql,
  buildGroupKeySql,
  compileViewQuery,
  cursorFromRow,
  decodeCursor,
  defaultQueryContext,
  encodeCursor,
  sortKeySelectSql,
  type QueryContext,
} from './query-builder.js';
import * as repo from './repo.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_EXPORT_ROWS = 10_000;
const MAX_MIGRATION_ROWS = 10_000;
const MAX_AUTO_OPTIONS = 100;

/** 建立資料庫時的預設欄位（Notion 的新資料庫就是這四欄） */
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

/* ── schema 驗證 ───────────────────────────────────────── */

const PROPERTY_ID_RE = /^[A-Za-z0-9_]{1,16}$/;

/** schema 的每個欄位都要過 field type registry 的驗證 */
export function validateSchema(schema: CollectionSchema): CollectionSchema {
  const entries = Object.entries(schema);
  if (!entries.some(([key]) => key === 'title')) {
    throw new AppError('INVALID_FIELD_TYPE', 'schema 必須包含 title 欄位');
  }
  if (entries.filter(([, def]) => def?.type === 'title').length !== 1) {
    throw new AppError('INVALID_FIELD_TYPE', '每個資料庫有且僅有一個 title 欄位');
  }

  const out: CollectionSchema = {};
  for (const [propertyId, def] of entries) {
    if (!PROPERTY_ID_RE.test(propertyId)) {
      throw new AppError('INVALID_FIELD_TYPE', `欄位 id 不合法：${propertyId}`);
    }
    out[propertyId] = getFieldType((def as FieldDefinition).type).validateConfig(def, {
      schema,
      propertyId,
    });
  }

  // 公式的循環引用必須在存檔時就擋掉，不能等到求值才發現（04 §8 M4 驗收標準）
  const cycles = findSchemaFormulaCycles(out);
  if (cycles.length > 0) {
    throw new AppError(
      'INVALID_FIELD_TYPE',
      `公式出現循環引用：${cycles.map((c) => c.join(' → ')).join('；')}`,
      { cycles },
    );
  }
  return out;
}

/* ── 讀取 ─────────────────────────────────────────────── */

async function loadCollection(collectionId: string, userId: string) {
  const row = await repo.findCollectionForUser(collectionId, userId);
  if (!row) throw new AppError('COLLECTION_NOT_FOUND');
  return row;
}

export async function getDatabase(collectionId: string, userId: string): Promise<DatabaseSnapshot> {
  const collection = await loadCollection(collectionId, userId);
  const views = await repo.listViews(collectionId);
  if (views.length === 0) {
    // 舊資料或被刪光視圖時自動補一個，不讓前端拿到空畫面
    const view = await repo.insertView(db, {
      workspaceId: collection.workspace_id,
      collectionId,
      type: 'table',
      name: '表格',
      query: {},
      format: defaultViewFormat(collection.schema ?? {}),
      createdBy: userId,
    });
    return { collection: repo.toCollection(collection), views: [repo.toView(view)] };
  }
  return { collection: repo.toCollection(collection), views: views.map(repo.toView) };
}

function defaultViewFormat(schema: CollectionSchema) {
  return {
    properties: Object.keys(schema).map((property, i) => ({
      property,
      visible: i < 5,
      width: property === 'title' ? 320 : 160,
    })),
    tableFreezeColumns: 1,
    tableRowNumbers: false,
  };
}

/* ── 建立資料庫 ───────────────────────────────────────── */

export interface CreateDatabaseInput {
  workspaceId: string;
  parentId?: string | null;
  title?: RichText;
  schema?: CollectionSchema;
  inline?: boolean;
}

export async function createDatabase(
  input: CreateDatabaseInput,
  userId: string,
): Promise<DatabaseSnapshot> {
  if (!(await getMemberRole(input.workspaceId, userId))) throw workspaceNotFound();
  const schema = validateSchema(input.schema ?? defaultSchema());
  const title = input.title ?? [{ text: '未命名資料庫' }];

  return withTransaction(async (tx) => {
    const parentId = input.parentId ?? null;
    if (parentId) {
      const parent = await pagesRepo.findPageForUser(parentId, userId, tx);
      if (!parent) throw pageNotFound();
    }
    const sortKey = await pagesRepo.computeSortKey(input.workspaceId, parentId, undefined, tx);
    const page = await pagesRepo.insertPage(tx, {
      workspaceId: input.workspaceId,
      parentId,
      title,
      sortKey,
      isDatabase: true,
      createdBy: userId,
    });

    const collection = await repo.insertCollection(tx, {
      workspaceId: input.workspaceId,
      pageId: page.id,
      name: title,
      schema,
      isInline: input.inline ?? false,
      createdBy: userId,
    });

    await tx.query(sql`
      UPDATE pages SET collection_id = ${collection.id} WHERE id = ${page.id}
    `);

    const view = await repo.insertView(tx, {
      workspaceId: input.workspaceId,
      collectionId: collection.id,
      type: 'table',
      name: '表格',
      query: {},
      format: defaultViewFormat(schema),
      createdBy: userId,
    });

    return { collection: repo.toCollection(collection), views: [repo.toView(view)] };
  });
}

/* ── schema 編輯與型別遷移 ───────────────────────────── */

/** 舊介面：整份 schema 覆蓋（不做值遷移） */
export async function patchSchema(
  collectionId: string,
  userId: string,
  schema: CollectionSchema,
): Promise<Collection> {
  await loadCollection(collectionId, userId);
  const validated = validateSchema(schema);
  const updated = await repo.updateCollectionSchema(db, collectionId, validated);
  if (!updated) throw new AppError('COLLECTION_NOT_FOUND');
  return repo.toCollection(updated);
}

/** 把一格的值從 from 型別轉成 to 型別（02 §4.3.1 的轉換矩陣） */
export function castValue(
  value: FieldValue | undefined,
  fromDef: FieldDefinition | undefined,
  toDef: FieldDefinition,
): { value: FieldValue | null; lossy: boolean } {
  if (value === undefined || fromDef === undefined) return { value: null, lossy: false };
  const target = getFieldType(toDef.type);

  if (target.coerceFrom) {
    const out = target.coerceFrom(value, fromDef.type, toDef);
    return { value: out, lossy: out === null };
  }

  const source = getFieldType(fromDef.type);
  const text = source.toPlainText(value, fromDef);
  if (text === '') return { value: null, lossy: false };
  if (!target.fromPlainText) return { value: null, lossy: true };

  try {
    const out = target.fromPlainText(text, toDef);
    return { value: out, lossy: out === null };
  } catch {
    return { value: null, lossy: true };
  }
}

/** 轉成 select / multiSelect 時，先把出現過的相異值建成選項（02 §4.3.1） */
function ensureOptionsForCast(
  toDef: FieldDefinition,
  rows: repo.RowRecord[],
  propertyId: string,
  fromDef: FieldDefinition,
): FieldDefinition {
  if (toDef.type !== 'select' && toDef.type !== 'multiSelect') return toDef;
  const source = getFieldType(fromDef.type);
  const options: SelectOption[] = [...(toDef.options ?? [])];
  const known = new Set(options.map((o) => o.value));

  for (const row of rows) {
    const raw = (row.properties ?? {})[propertyId];
    const text = source.toPlainText(raw, fromDef);
    if (text === '') continue;
    const parts = toDef.type === 'multiSelect' ? text.split(/[,、;]/) : [text];
    for (const part of parts) {
      const label = part.trim();
      if (label === '' || known.has(label)) continue;
      if (options.length >= MAX_AUTO_OPTIONS) break;
      known.add(label);
      options.push({
        id: generateOptionId(options.map((o) => o.id)),
        value: label,
        color: 'default',
      });
    }
  }
  return { ...toDef, options } as FieldDefinition;
}

export async function previewCast(
  collectionId: string,
  userId: string,
  propertyId: string,
  toType: FieldType,
): Promise<CastPreview> {
  const collection = await loadCollection(collectionId, userId);
  const schema = (collection.schema ?? {}) as CollectionSchema;
  const fromDef = schema[propertyId];
  if (!fromDef) throw new AppError('INVALID_FIELD_TYPE', `欄位不存在：${propertyId}`);

  const rows = await repo.streamAllRows(collectionId, null, sql`p.sort_key ASC`, MAX_MIGRATION_ROWS);
  const baseDef = { name: fromDef.name, type: toType } as FieldDefinition;
  const toDef = getFieldType(toType).validateConfig(
    ensureOptionsForCast(baseDef, rows, propertyId, fromDef),
    { schema, propertyId },
  );

  let affected = 0;
  let convertible = 0;
  const samples: string[] = [];
  const source = getFieldType(fromDef.type);

  for (const row of rows) {
    const raw = (row.properties ?? {})[propertyId];
    if (raw === undefined) continue;
    affected += 1;
    const result = castValue(raw, fromDef, toDef);
    if (result.value !== null) convertible += 1;
    else if (samples.length < 5) {
      const text = source.toPlainText(raw, fromDef);
      if (text !== '') samples.push(text);
    }
  }

  return {
    propertyId,
    fromType: fromDef.type,
    toType,
    affected,
    convertible,
    lossy: affected - convertible,
    samples,
  };
}

/**
 * ops 版的 schema 編輯：新增 / 改名 / 改設定 / 改型別 / 刪除。
 * 改型別時同一個交易內做值遷移，轉不動的**清空**（並在回傳的 report 裡說明）。
 */
export async function applySchemaOps(
  collectionId: string,
  userId: string,
  ops: SchemaOp[],
): Promise<PatchSchemaResult> {
  const collection = await loadCollection(collectionId, userId);
  const original = (collection.schema ?? {}) as CollectionSchema;

  return withTransaction(async (tx) => {
    let schema: CollectionSchema = { ...original };
    const migrations: SchemaMigrationReport[] = [];
    /** propertyId → 每一列的新值（null = 刪掉 key） */
    const pendingWrites = new Map<string, Map<string, FieldValue | null>>();

    for (const op of ops) {
      switch (op.op) {
        case 'add': {
          const propertyId = op.propertyId ?? generatePropertyId(Object.keys(schema));
          if (schema[propertyId]) {
            throw new AppError('INVALID_FIELD_TYPE', `欄位 id 已存在：${propertyId}`);
          }
          if (op.definition.type === 'title') {
            throw new AppError('INVALID_FIELD_TYPE', '每個資料庫只能有一個 title 欄位');
          }
          schema[propertyId] = op.definition;
          break;
        }
        case 'rename': {
          const existing = schema[op.propertyId];
          if (!existing) throw new AppError('INVALID_FIELD_TYPE', `欄位不存在：${op.propertyId}`);
          schema[op.propertyId] = { ...existing, name: op.name };
          break;
        }
        case 'update': {
          const existing = schema[op.propertyId];
          if (!existing) throw new AppError('INVALID_FIELD_TYPE', `欄位不存在：${op.propertyId}`);
          if (existing.type !== op.definition.type) {
            throw new AppError('INVALID_FIELD_TYPE', '改型別請用 retype，才會做值遷移');
          }
          schema[op.propertyId] = op.definition;
          break;
        }
        case 'delete': {
          if (op.propertyId === 'title') {
            throw new AppError('INVALID_FIELD_TYPE', 'title 欄位不能刪除');
          }
          if (!schema[op.propertyId]) {
            throw new AppError('INVALID_FIELD_TYPE', `欄位不存在：${op.propertyId}`);
          }
          delete schema[op.propertyId];
          break;
        }
        case 'retype': {
          const fromDef = schema[op.propertyId];
          if (!fromDef) throw new AppError('INVALID_FIELD_TYPE', `欄位不存在：${op.propertyId}`);
          if (op.propertyId === 'title' || op.definition.type === 'title') {
            throw new AppError('INVALID_FIELD_TYPE', 'title 欄位不能改型別');
          }

          const rows = await repo.streamAllRows(
            collectionId,
            null,
            sql`p.sort_key ASC`,
            MAX_MIGRATION_ROWS,
            tx,
          );
          const toDef = getFieldType(op.definition.type).validateConfig(
            ensureOptionsForCast(op.definition, rows, op.propertyId, fromDef),
            { schema, propertyId: op.propertyId },
          );

          const writes = new Map<string, FieldValue | null>();
          const report: SchemaMigrationReport = {
            propertyId: op.propertyId,
            scanned: 0,
            converted: 0,
            cleared: 0,
          };

          for (const row of rows) {
            const raw = (row.properties ?? {})[op.propertyId];
            if (raw === undefined) continue;
            report.scanned += 1;
            const result = castValue(raw, fromDef, toDef);
            writes.set(row.id, result.value);
            if (result.value === null) report.cleared += 1;
            else report.converted += 1;
          }

          schema[op.propertyId] = toDef;
          pendingWrites.set(op.propertyId, writes);
          migrations.push(report);
          break;
        }
        default:
          throw new AppError('BAD_REQUEST', '不認得的 schema 操作');
      }
    }

    schema = validateSchema(schema);

    // 值遷移：一列一個 UPDATE，但都在同一個交易內（03 §9.5：交易要短，
    // 所以 MAX_MIGRATION_ROWS 有上限；超過時請走匯出/匯入）
    for (const [propertyId, writes] of pendingWrites) {
      for (const [rowId, value] of writes) {
        if (value === null) {
          await tx.query(sql`
            UPDATE pages SET properties = properties - ${propertyId}, version = version + 1
             WHERE id = ${rowId}
          `);
        } else {
          await tx.query(sql`
            UPDATE pages
               SET properties = jsonb_set(properties, ARRAY[${propertyId}]::text[],
                                          ${JSON.stringify(value)}::jsonb, true),
                   version = version + 1
             WHERE id = ${rowId}
          `);
        }
      }
    }

    const updated = await repo.updateCollectionSchema(tx, collectionId, schema);
    if (!updated) throw new AppError('COLLECTION_NOT_FOUND');
    return { collection: repo.toCollection(updated), migrations };
  });
}

/* ── 查詢列 ───────────────────────────────────────────── */

export interface QueryRowsOptions {
  viewId?: string;
  limit?: number;
  cursor?: string;
  /** 覆寫視圖設定（前端搜尋框即時查詢時用，不改存檔設定） */
  search?: string;
  /** 舊介面：offset 分頁（cursor 才是主路徑） */
  offset?: number;
  timeZone?: string;
}

async function loadRollupSources(
  schema: CollectionSchema,
  rows: repo.RowRecord[],
  conn: Queryable = db,
): Promise<RollupSources> {
  const sources: RollupSources = new Map();
  const relationProps = schemaRelationProperties(schema);
  if (relationProps.length === 0) return sources;

  for (const relationProp of relationProps) {
    const def = schema[relationProp];
    if (!def || def.type !== 'relation') continue;
    const targetIds = new Set<string>();
    for (const row of rows) {
      const value = (row.properties ?? {})[relationProp];
      if (value && value.type === 'relation') for (const id of value.pageIds) targetIds.add(id);
    }
    const targetRows = await repo.findRowsByIds([...targetIds], conn);
    const targetCollection = def.collectionId
      ? await repo.findCollectionById(def.collectionId, conn)
      : null;
    const source: RollupSource = {
      schema: (targetCollection?.schema ?? {}) as CollectionSchema,
      rows: new Map(
        targetRows.map((r) => [
          r.id,
          {
            ...(r.properties ?? {}),
            title: {
              type: 'title' as const,
              richText: r.title ?? [],
              plainText: richTextToPlainText(r.title ?? []),
            },
          } as RowProperties,
        ]),
      ),
    };
    sources.set(relationProp, source);
  }
  return sources;
}

function materializeRow(
  record: repo.RowRecord,
  schema: CollectionSchema,
  sources: RollupSources,
  now: Date,
  hasComputed: boolean,
): DatabaseRow {
  const row = repo.toRow(record);
  const withTitle: RowProperties = {
    ...row.properties,
    title: {
      type: 'title',
      richText: row.title,
      plainText: richTextToPlainText(row.title),
    },
  };
  row.properties = hasComputed
    ? computeRowProperties(
        schema,
        withTitle,
        {
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          createdBy: row.createdBy,
          updatedBy: row.updatedBy,
        },
        sources,
        now,
      )
    : withTitle;
  return row;
}

async function buildAggregations(
  collectionId: string,
  schema: CollectionSchema,
  aggregations: Record<string, AggregationFunction> | undefined,
  where: Sql | null,
): Promise<AggregationResult[]> {
  const entries = Object.entries(aggregations ?? {}).filter(([, fn]) => fn && fn !== 'none');
  if (entries.length === 0) return [];

  const selects: Sql[] = [];
  const meta: Array<{ property: string; fn: AggregationFunction; alias: string }> = [];
  entries.forEach(([property, fn], i) => {
    if (!schema[property]) return;
    const expr = buildAggregationSql(schema, property, fn);
    if (!expr) return;
    const alias = `a${i}`;
    selects.push(sql`${expr} AS ${sql.raw(alias)}`);
    meta.push({ property, fn, alias });
  });
  if (selects.length === 0) return [];

  const row = await repo.queryAggregations(collectionId, where, selects);
  return meta.map((m) => {
    const raw = row[m.alias] ?? null;
    const asNumber = raw === null ? null : Number(raw);
    return {
      property: m.property,
      function: m.fn,
      value: raw === null ? null : Number.isFinite(asNumber) ? (asNumber as number) : raw,
    };
  });
}

export async function queryRows(
  collectionId: string,
  userId: string,
  opts: QueryRowsOptions,
): Promise<QueryRowsResult> {
  const collection = await loadCollection(collectionId, userId);
  const schema = (collection.schema ?? {}) as CollectionSchema;

  let view = null;
  if (opts.viewId) {
    view = await repo.findView(opts.viewId, collectionId);
    if (!view) throw new AppError('VIEW_NOT_FOUND');
  }

  const query: ViewQuery = { ...(view?.query ?? {}) };
  if (opts.search !== undefined) query.searchQuery = opts.search;

  const ctx: QueryContext = defaultQueryContext(opts.timeZone);
  const compiled = compileViewQuery(schema, query, ctx);
  const limit = Math.min(opts.limit ?? query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const hasComputed = schemaHasComputed(schema);

  const aggregations = await buildAggregations(
    collectionId,
    schema,
    query.aggregations,
    compiled.where,
  );

  /* 分組（Board）：一次取回每組前 N 張卡 + 每組總數 */
  if (query.groupBy?.property && schema[query.groupBy.property]) {
    const groupKeySql = buildGroupKeySql(schema, query.groupBy.property);
    const records = await repo.queryGroupedRows(collectionId, {
      where: compiled.where,
      order: compiled.sort.order,
      sortKeys: sql.empty,
      limit,
      groupKey: groupKeySql,
      perGroup: limit,
    });
    const sources = await loadRollupSources(schema, records);
    const groups = assembleGroups(
      schema,
      query.groupBy.property,
      query.groupBy.hideEmptyGroups ?? false,
      records,
      sources,
      ctx.now,
      hasComputed,
    );
    const rows = groups.flatMap((g) => g.rows);
    return {
      collectionId,
      viewId: view?.id ?? null,
      rows,
      groups,
      aggregations,
      cursor: null,
      hasMore: groups.some((g) => g.hasMore),
      total: groups.reduce((sum, g) => sum + g.count, 0),
    };
  }

  /* 計算欄位參與 filter/sort → 記憶體路徑（關閉 keyset，改 offset） */
  if (compiled.memoryFilter || compiled.memorySort) {
    const offset = opts.cursor ? Number(decodeCursor(opts.cursor).keys[0] ?? 0) : (opts.offset ?? 0);
    const records = await repo.streamAllRows(
      collectionId,
      compiled.where,
      compiled.sort.order,
      MEMORY_SCAN_LIMIT,
    );
    const sources = await loadRollupSources(schema, records);
    let rows = records.map((r) => materializeRow(r, schema, sources, ctx.now, true));
    if (compiled.memoryFilter) {
      rows = rows.filter((r) => matchesFilter(schema, r.properties, query.filter, ctx));
    }
    if (compiled.memorySort) rows = sortInMemory(rows, schema, query.sort);
    const page = rows.slice(offset, offset + limit);
    const hasMore = rows.length > offset + limit;
    return {
      collectionId,
      viewId: view?.id ?? null,
      rows: page,
      aggregations,
      cursor: hasMore ? encodeCursor({ keys: [offset + limit], id: '' }) : null,
      hasMore,
      total: rows.length,
    };
  }

  /* 一般路徑：keyset（cursor）分頁 */
  const conditions: Sql[] = [];
  if (compiled.where) conditions.push(compiled.where);
  if (opts.cursor) conditions.push(buildCursorSql(compiled.sort, decodeCursor(opts.cursor)));
  const where = conditions.length === 0 ? null : sql`(${sql.join(conditions, ' AND ')})`;

  const records = await repo.queryRows(collectionId, {
    where,
    order: compiled.sort.order,
    sortKeys: sortKeySelectSql(compiled.sort),
    limit: limit + 1, // 多取一筆判斷 hasMore，不必再跑一次 count
  });

  const hasMore = records.length > limit;
  const pageRecords = hasMore ? records.slice(0, limit) : records;
  const sources = await loadRollupSources(schema, pageRecords);
  const rows = pageRecords.map((r) => materializeRow(r, schema, sources, ctx.now, hasComputed));
  const total = await repo.countRows(collectionId, compiled.where);
  const last = pageRecords[pageRecords.length - 1];

  return {
    collectionId,
    viewId: view?.id ?? null,
    rows,
    aggregations,
    cursor: hasMore && last ? encodeCursor(cursorFromRow(last, compiled.sort)) : null,
    hasMore,
    total,
  };
}

function assembleGroups(
  schema: CollectionSchema,
  property: string,
  hideEmpty: boolean,
  records: repo.GroupedRowRecord[],
  sources: RollupSources,
  now: Date,
  hasComputed: boolean,
): RowGroup[] {
  const def = schema[property];
  if (!def) return [];
  const fieldType = getFieldType(def.type);

  const buckets = new Map<string | null, { count: number; rows: DatabaseRow[] }>();
  for (const record of records) {
    const key = record.group_key ?? null;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { count: record.group_total ?? 0, rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(materializeRow(record, schema, sources, now, hasComputed));
  }

  // 泳道順序 = schema 裡的選項順序（使用者拖曳選項就是在定義順序），空組排最後
  const ordered: Array<string | null> = [];
  const options = (def as { options?: SelectOption[] }).options ?? [];
  for (const option of options) ordered.push(option.id);
  if (def.type === 'checkbox') ordered.push('true', 'false');
  for (const key of buckets.keys()) {
    if (key !== null && !ordered.includes(key)) ordered.push(key);
  }
  ordered.push(null);

  const groups: RowGroup[] = [];
  for (const key of ordered) {
    const bucket = buckets.get(key);
    if (!bucket && hideEmpty) continue;
    if (!bucket && key !== null && options.length === 0 && def.type !== 'checkbox') continue;
    const label = fieldType.groupLabel(key, def);
    groups.push({
      key,
      label: label.label,
      ...(label.color ? { color: label.color } : {}),
      count: bucket?.count ?? 0,
      rows: bucket?.rows ?? [],
      hasMore: (bucket?.count ?? 0) > (bucket?.rows.length ?? 0),
    });
  }
  return groups;
}

/* ── 列的寫入 ─────────────────────────────────────────── */

/** 依 schema 正規化一整列的欄位值。清空 = 刪掉整個 key（03 §6.4） */
export function normalizeRowProperties(
  schema: CollectionSchema,
  input: RowProperties | undefined,
  previous: RowProperties = {},
): RowProperties {
  const out: RowProperties = { ...previous };
  for (const [propertyId, raw] of Object.entries(input ?? {})) {
    const def = schema[propertyId];
    if (!def) throw new AppError('INVALID_FIELD_VALUE', `欄位不存在：${propertyId}`);
    if (propertyId === 'title') continue; // title 的真值在 pages.title
    const fieldType = getFieldType(def.type);
    if (fieldType.computed) continue; // 計算欄位寫入一律忽略
    const normalized = fieldType.normalize(raw, def);
    if (normalized === null) delete out[propertyId];
    else out[propertyId] = normalized;
  }
  return out;
}

/** 從 properties.title 取出標題（前端只要送 properties 就好） */
function titleFromInput(input: {
  title?: RichText;
  properties?: RowProperties;
}): RichText | undefined {
  if (input.title !== undefined) return input.title;
  const raw = input.properties?.title;
  if (raw && (raw.type === 'title' || raw.type === 'text')) return raw.richText;
  return undefined;
}

/**
 * relation 的雙向維護：更新邊表，並把反向欄位寫回目標列。
 * 真值是 properties（03 §4.8），邊表與反向欄位都是同一個交易內的投影。
 */
async function syncRelations(
  tx: Queryable,
  params: {
    workspaceId: string;
    rowId: string;
    schema: CollectionSchema;
    before: RowProperties;
    after: RowProperties;
  },
): Promise<void> {
  for (const [propertyId, def] of Object.entries(params.schema)) {
    if (def?.type !== 'relation') continue;
    const beforeValue = params.before[propertyId];
    const afterValue = params.after[propertyId];
    const beforeIds = beforeValue && beforeValue.type === 'relation' ? beforeValue.pageIds : [];
    const afterIds = afterValue && afterValue.type === 'relation' ? afterValue.pageIds : [];
    if (beforeIds.join(',') === afterIds.join(',')) continue;

    await repo.replaceRelationEdges(tx, {
      workspaceId: params.workspaceId,
      fromRowId: params.rowId,
      fromProperty: propertyId,
      toProperty: def.dualProperty ?? null,
      toRowIds: afterIds,
    });

    if (!def.dualProperty) continue;
    const dualProperty = def.dualProperty;
    const touched = [...new Set([...beforeIds, ...afterIds])];
    const targets = await repo.findRowsForRelationUpdate(touched, tx);
    for (const target of targets) {
      const props = (target.properties ?? {}) as RowProperties;
      const existing = props[dualProperty];
      const ids = existing && existing.type === 'relation' ? [...existing.pageIds] : [];
      const shouldContain = afterIds.includes(target.id);
      const index = ids.indexOf(params.rowId);
      if (shouldContain && index === -1) ids.push(params.rowId);
      if (!shouldContain && index >= 0) ids.splice(index, 1);

      const next: RowProperties = { ...props };
      if (ids.length === 0) delete next[dualProperty];
      else next[dualProperty] = { type: 'relation', pageIds: ids };
      await repo.setRowPropertiesRaw(tx, target.id, next);

      // 反向邊（B → A）也要維護，否則反查會漏
      await repo.replaceRelationEdges(tx, {
        workspaceId: params.workspaceId,
        fromRowId: target.id,
        fromProperty: dualProperty,
        toProperty: propertyId,
        toRowIds: ids,
      });
    }
  }
}

export async function createRow(
  collectionId: string,
  userId: string,
  input: {
    title?: RichText;
    properties?: RowProperties;
    /** 看板「＋ 新增」：直接落在某個泳道 */
    group?: { property: string; key: string | null };
  },
): Promise<DatabaseRow> {
  const collection = await loadCollection(collectionId, userId);
  const schema = (collection.schema ?? {}) as CollectionSchema;
  const properties = normalizeRowProperties(schema, input.properties);

  // 預設值（checkbox 的 false 等）
  for (const [propertyId, def] of Object.entries(schema)) {
    if (propertyId === 'title' || properties[propertyId] !== undefined) continue;
    const fallback = getFieldType(def.type).defaultValue(def);
    if (fallback) properties[propertyId] = fallback;
  }

  if (input.group && input.group.key !== null) {
    const def = schema[input.group.property];
    if (def) {
      const value = getFieldType(def.type).normalize(
        def.type === 'multiSelect' ? [input.group.key] : input.group.key,
        def,
      );
      if (value) properties[input.group.property] = value;
    }
  }

  return withTransaction(async (tx) => {
    const sortKey = await pagesRepo.computeSortKey(
      collection.workspace_id,
      collection.page_id,
      undefined,
      tx,
    );
    const page = await pagesRepo.insertPage(tx, {
      workspaceId: collection.workspace_id,
      parentId: collection.page_id,
      title: titleFromInput(input) ?? [],
      sortKey,
      collectionId,
      properties: properties as Record<string, unknown>,
      createdBy: userId,
    });

    await syncRelations(tx, {
      workspaceId: collection.workspace_id,
      rowId: page.id,
      schema,
      before: {},
      after: properties,
    });

    const row = await repo.findRow(page.id, collectionId, tx);
    if (!row) throw new AppError('ROW_NOT_FOUND');
    return materializeRow(row, schema, new Map(), new Date(), schemaHasComputed(schema));
  });
}

export async function patchRow(
  collectionId: string,
  rowId: string,
  userId: string,
  input: { title?: RichText; icon?: string | null; cover?: string | null; properties?: RowProperties },
): Promise<DatabaseRow> {
  const collection = await loadCollection(collectionId, userId);
  const schema = (collection.schema ?? {}) as CollectionSchema;
  const existing = await repo.findRow(rowId, collectionId);
  if (!existing) throw new AppError('ROW_NOT_FOUND');

  const before = (existing.properties ?? {}) as RowProperties;
  const properties =
    input.properties === undefined ? undefined : normalizeRowProperties(schema, input.properties, before);
  const title = titleFromInput(input);

  const updated = await withTransaction(async (tx) => {
    const row = await repo.updateRowProperties(
      tx,
      rowId,
      {
        ...(title !== undefined ? { title } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.cover !== undefined ? { cover: input.cover } : {}),
        ...(properties !== undefined ? { properties } : {}),
      },
      userId,
    );
    if (!row) throw new AppError('ROW_NOT_FOUND');
    if (properties) {
      await syncRelations(tx, {
        workspaceId: collection.workspace_id,
        rowId,
        schema,
        before,
        after: properties,
      });
    }
    return row;
  });

  const sources = await loadRollupSources(schema, [updated]);
  return materializeRow(updated, schema, sources, new Date(), schemaHasComputed(schema));
}

export async function deleteRow(
  collectionId: string,
  rowId: string,
  userId: string,
): Promise<void> {
  const collection = await loadCollection(collectionId, userId);
  const existing = await repo.findRow(rowId, collectionId);
  if (!existing) throw new AppError('ROW_NOT_FOUND');

  await withTransaction(async (tx) => {
    // 先把 relation 清掉，反向欄位才不會留下指向垃圾桶的幽靈
    await syncRelations(tx, {
      workspaceId: collection.workspace_id,
      rowId,
      schema: (collection.schema ?? {}) as CollectionSchema,
      before: (existing.properties ?? {}) as RowProperties,
      after: {},
    });
    const ok = await repo.softDeleteRow(tx, rowId, collectionId);
    if (!ok) throw new AppError('ROW_NOT_FOUND');
  });
}

export async function duplicateRow(
  collectionId: string,
  rowId: string,
  userId: string,
): Promise<DatabaseRow> {
  const collection = await loadCollection(collectionId, userId);
  const schema = (collection.schema ?? {}) as CollectionSchema;
  const existing = await repo.findRow(rowId, collectionId);
  if (!existing) throw new AppError('ROW_NOT_FOUND');

  const title: RichText = [...(existing.title ?? [])];
  const plain = richTextToPlainText(title);
  const copiedTitle: RichText = plain === '' ? [{ text: '副本' }] : [{ text: `${plain} 副本` }];

  return createRow(collectionId, userId, {
    title: copiedTitle,
    properties: existing.properties ?? {},
  }).then(async (row) => {
    // createRow 已經處理 relation 與預設值；這裡只補 icon/cover
    if (existing.icon || existing.cover) {
      await repo.updateRowProperties(
        db,
        row.id,
        { icon: existing.icon, cover: existing.cover },
        userId,
      );
    }
    void schema;
    return row;
  });
}

/* ── 視圖 ─────────────────────────────────────────────── */

export async function createView(
  collectionId: string,
  userId: string,
  input: CreateViewRequest,
): Promise<CollectionView> {
  const collection = await loadCollection(collectionId, userId);
  const schema = (collection.schema ?? {}) as CollectionSchema;
  if (input.query) validateViewQuery(schema, input.query);
  const view = await repo.insertView(db, {
    workspaceId: collection.workspace_id,
    collectionId,
    type: input.type,
    name: input.name ?? '新檢視',
    query: input.query ?? {},
    format: input.format ?? defaultViewFormat(schema),
    createdBy: userId,
  });
  return repo.toView(view);
}

function validateViewQuery(schema: CollectionSchema, query: ViewQuery): void {
  // 送出前先驗證 filter/sort 能不能組成合法 SQL，不要等到查詢時才炸
  const ctx = defaultQueryContext();
  compileViewQuery(schema, query, ctx);
  if (query.groupBy?.property) buildGroupKeySql(schema, query.groupBy.property);
  for (const [property, fn] of Object.entries(query.aggregations ?? {})) {
    if (fn && fn !== 'none' && schema[property]) buildAggregationSql(schema, property, fn);
  }
}

export async function patchView(
  collectionId: string,
  viewId: string,
  userId: string,
  input: PatchViewRequest,
): Promise<CollectionView> {
  const collection = await loadCollection(collectionId, userId);
  const existing = await repo.findView(viewId, collectionId);
  if (!existing) throw new AppError('VIEW_NOT_FOUND');
  if (input.query) validateViewQuery((collection.schema ?? {}) as CollectionSchema, input.query);
  const updated = await repo.updateView(db, viewId, input);
  if (!updated) throw new AppError('VIEW_NOT_FOUND');
  return repo.toView(updated);
}

export async function deleteView(
  collectionId: string,
  viewId: string,
  userId: string,
): Promise<void> {
  await loadCollection(collectionId, userId);
  if ((await repo.countViews(collectionId)) <= 1) {
    throw new AppError('CONFLICT', '至少要保留一個檢視');
  }
  const ok = await repo.softDeleteView(db, viewId, collectionId);
  if (!ok) throw new AppError('VIEW_NOT_FOUND');
}

export async function duplicateView(
  collectionId: string,
  viewId: string,
  userId: string,
): Promise<CollectionView> {
  const collection = await loadCollection(collectionId, userId);
  const existing = await repo.findView(viewId, collectionId);
  if (!existing) throw new AppError('VIEW_NOT_FOUND');
  const view = await repo.insertView(db, {
    workspaceId: collection.workspace_id,
    collectionId,
    type: existing.type,
    name: `${existing.name} 副本`,
    query: existing.query ?? {},
    format: existing.format ?? {},
    createdBy: userId,
  });
  return repo.toView(view);
}

/* ── CSV 匯出 ─────────────────────────────────────────── */

function csvCell(value: string): string {
  if (value === '') return '';
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function exportCsv(
  collectionId: string,
  userId: string,
  viewId?: string,
): Promise<string> {
  const collection = await loadCollection(collectionId, userId);
  const schema = (collection.schema ?? {}) as CollectionSchema;
  const view = viewId ? await repo.findView(viewId, collectionId) : null;
  const ctx = defaultQueryContext();
  const compiled = compileViewQuery(schema, view?.query ?? {}, ctx);

  // 視圖有隱藏欄位時，匯出跟著隱藏（使用者看到什麼就匯出什麼）
  const formatProps = view?.format?.properties ?? [];
  const visible = formatProps.filter((p) => p.visible !== false).map((p) => p.property);
  const columns = (visible.length > 0 ? visible : Object.keys(schema)).filter((id) => schema[id]);
  if (!columns.includes('title')) columns.unshift('title');

  const records = await repo.streamAllRows(
    collectionId,
    compiled.where,
    compiled.sort.order,
    MAX_EXPORT_ROWS,
  );
  const sources = await loadRollupSources(schema, records);
  const hasComputed = schemaHasComputed(schema);

  const lines: string[] = [
    columns.map((id) => csvCell(schema[id]?.name ?? id)).join(','),
  ];
  for (const record of records) {
    const row = materializeRow(record, schema, sources, ctx.now, hasComputed);
    const cells = columns.map((id) => {
      const def = schema[id];
      if (!def) return '';
      return csvCell(getFieldType(def.type).toPlainText(row.properties[id], def));
    });
    lines.push(cells.join(','));
  }
  // BOM：Excel 開 UTF-8 CSV 不加 BOM 中文會變亂碼
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/* ── 給前端的 registry 快照（型別選單用） ─────────────── */

export function describeFieldTypes() {
  return listFieldTypes().map((f) => ({
    type: f.type,
    label: f.label,
    computed: f.computed,
    groupable: f.groupable,
    sortable: f.sortable,
    filterOperators: f.filterOperators,
    aggregations: f.aggregations,
  }));
}
