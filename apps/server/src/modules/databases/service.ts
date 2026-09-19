/**
 * Database 系統（最小骨架）。M4 才會長出完整功能，
 * 但 registry 與 query-builder 的形狀現在就定下來，之後只會往裡面加檔案。
 */
import type {
  Collection,
  CollectionSchema,
  CollectionView,
  CreateDatabaseRequest,
  CreateViewRequest,
  DatabaseRow,
  DatabaseSnapshot,
  FieldDefinition,
  PatchViewRequest,
  QueryRowsResult,
  RichText,
  RowProperties,
} from '@kennote/shared-types';
import { db, withTransaction } from '../../db/client.js';
import { AppError, pageNotFound, workspaceNotFound } from '../../lib/errors.js';
import { getMemberRole } from '../workspaces/repo.js';
import * as pagesRepo from '../pages/repo.js';
import { getFieldType } from './field-types/index.js';
import { buildFilterSql, buildOrderSql } from './query-builder.js';
import * as repo from './repo.js';

const DEFAULT_SCHEMA: CollectionSchema = {
  title: { name: '名稱', type: 'title' },
  Sta1: {
    name: '狀態',
    type: 'select',
    options: [
      { id: 'opt_todo', value: '未開始', color: 'gray' },
      { id: 'opt_doing', value: '進行中', color: 'blue' },
      { id: 'opt_done', value: '已完成', color: 'green' },
    ],
  },
  Due1: { name: '截止日', type: 'date' },
};

/** schema 的每個欄位都要過 field type registry 的驗證 */
export function validateSchema(schema: CollectionSchema): CollectionSchema {
  const entries = Object.entries(schema);
  if (!entries.some(([key]) => key === 'title')) {
    throw new AppError('INVALID_FIELD_TYPE', 'schema 必須包含 title 欄位');
  }
  const out: CollectionSchema = {};
  for (const [propertyId, def] of entries) {
    if (!/^[A-Za-z0-9_]{1,16}$/.test(propertyId)) {
      throw new AppError('INVALID_FIELD_TYPE', `欄位 id 不合法：${propertyId}`);
    }
    out[propertyId] = getFieldType((def as FieldDefinition).type).validateConfig(def);
  }
  return out;
}

export async function createDatabase(
  input: CreateDatabaseRequest,
  userId: string,
): Promise<DatabaseSnapshot> {
  if (!(await getMemberRole(input.workspaceId, userId))) throw workspaceNotFound();
  const schema = validateSchema(input.schema ?? DEFAULT_SCHEMA);

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
      title: input.title ?? [{ text: '未命名資料庫' }],
      sortKey,
      isDatabase: true,
      createdBy: userId,
    });

    const collection = await repo.insertCollection(tx, {
      workspaceId: input.workspaceId,
      pageId: page.id,
      name: input.title ?? [{ text: '未命名資料庫' }],
      schema,
      createdBy: userId,
    });

    await tx.query(
      (await import('../../db/sql.js')).sql`
        UPDATE pages SET collection_id = ${collection.id} WHERE id = ${page.id}
      `,
    );

    const view = await repo.insertView(tx, {
      workspaceId: input.workspaceId,
      collectionId: collection.id,
      type: 'table',
      name: '表格',
      query: { sort: [] },
      format: {
        properties: Object.keys(schema).map((property) => ({ property, visible: true, width: 200 })),
      },
      createdBy: userId,
    });

    return { collection: repo.toCollection(collection), views: [repo.toView(view)] };
  });
}

async function loadCollection(collectionId: string, userId: string) {
  const row = await repo.findCollectionForUser(collectionId, userId);
  if (!row) throw new AppError('COLLECTION_NOT_FOUND');
  return row;
}

export async function getDatabase(collectionId: string, userId: string): Promise<DatabaseSnapshot> {
  const collection = await loadCollection(collectionId, userId);
  const views = await repo.listViews(collectionId);
  return { collection: repo.toCollection(collection), views: views.map(repo.toView) };
}

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

/** GET /api/databases/:id/rows?viewId= —— 先支援 filter/sort 的基本版 */
export async function queryRows(
  collectionId: string,
  userId: string,
  opts: { viewId?: string; limit?: number; offset?: number },
): Promise<QueryRowsResult> {
  const collection = await loadCollection(collectionId, userId);
  const schema = collection.schema ?? {};

  let view = null;
  if (opts.viewId) {
    view = await repo.findView(opts.viewId, collectionId);
    if (!view) throw new AppError('VIEW_NOT_FOUND');
  }

  const where = buildFilterSql(schema, view?.query?.filter ?? null);
  const order = buildOrderSql(schema, view?.query?.sort);
  const limit = Math.min(opts.limit ?? view?.query?.pageSize ?? 50, 200);
  const offset = opts.offset ?? 0;

  const { rows, total } = await repo.queryRows(collectionId, { where, order, limit, offset });
  return {
    collectionId,
    viewId: view?.id ?? null,
    rows: rows.map(repo.toRow),
    total,
    hasMore: offset + rows.length < total,
  };
}

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
    const normalized = getFieldType(def.type).normalize(raw, def);
    if (normalized === null) delete out[propertyId];
    else out[propertyId] = normalized;
  }
  return out;
}

export async function createRow(
  collectionId: string,
  userId: string,
  input: { title?: RichText; properties?: RowProperties },
): Promise<DatabaseRow> {
  const collection = await loadCollection(collectionId, userId);
  const properties = normalizeRowProperties(collection.schema ?? {}, input.properties);

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
      title: input.title ?? [],
      sortKey,
      collectionId,
      properties: properties as Record<string, unknown>,
      createdBy: userId,
    });
    const row = await repo.findRow(page.id, collectionId, tx);
    if (!row) throw new AppError('ROW_NOT_FOUND');
    return repo.toRow(row);
  });
}

export async function patchRow(
  collectionId: string,
  rowId: string,
  userId: string,
  input: { title?: RichText; icon?: string | null; properties?: RowProperties },
): Promise<DatabaseRow> {
  const collection = await loadCollection(collectionId, userId);
  const existing = await repo.findRow(rowId, collectionId);
  if (!existing) throw new AppError('ROW_NOT_FOUND');

  const properties =
    input.properties === undefined
      ? undefined
      : normalizeRowProperties(collection.schema ?? {}, input.properties, existing.properties ?? {});

  const updated = await repo.updateRowProperties(
    db,
    rowId,
    { ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(properties !== undefined ? { properties } : {}) },
    userId,
  );
  if (!updated) throw new AppError('ROW_NOT_FOUND');
  return repo.toRow(updated);
}

export async function createView(
  collectionId: string,
  userId: string,
  input: CreateViewRequest,
): Promise<CollectionView> {
  const collection = await loadCollection(collectionId, userId);
  const view = await repo.insertView(db, {
    workspaceId: collection.workspace_id,
    collectionId,
    type: input.type,
    name: input.name ?? '新檢視',
    query: input.query ?? {},
    format: input.format ?? {},
    createdBy: userId,
  });
  return repo.toView(view);
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
  // 送出前先驗證 filter/sort 能不能組成合法 SQL，不要等到查詢時才炸
  if (input.query) {
    buildFilterSql(collection.schema ?? {}, input.query.filter ?? null);
    buildOrderSql(collection.schema ?? {}, input.query.sort);
  }
  const updated = await repo.updateView(db, viewId, input);
  if (!updated) throw new AppError('VIEW_NOT_FOUND');
  return repo.toView(updated);
}
