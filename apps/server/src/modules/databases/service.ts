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
  ViewFormat,
  ViewPropertyFormat,
  ViewQuery,
} from '@kennote/shared-types';
import { findSchemaFormulaCycles, richTextToPlainText } from '@kennote/shared-types';
import type { PagePermission } from '@kennote/shared-types';
import { db, withTransaction, type Queryable } from '../../db/client.js';
import { sql, type Sql } from '../../db/sql.js';
import { AppError, workspaceNotFound } from '../../lib/errors.js';
import { getMemberRole } from '../workspaces/repo.js';
import { buildPermissionIndex, canSee } from '../permissions/bulk.js';
import { requirePagePermission } from '../permissions/service.js';
import * as pagesRepo from '../pages/repo.js';
import { generateKeyBetween } from '../../lib/fractional.js';
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

/**
 * ⭐ 第八輪 BUG-40：**資料庫的權限就是它載體頁的權限**。
 *
 * 原本這裡是一支「只 JOIN workspace_members 的 collection 查詢」—— 跟 `findPageInUserWorkspace()` 一樣
 * 只 JOIN `workspace_members`，回答的是「你是不是這個工作區的人」。
 * 於是 `WORKSPACE_ROLE_BASELINE.guest === 'none'` 的 guest 可以
 * **讀整個資料庫、改儲存格、改 schema、刪視圖、匯出 CSV** ——
 * 第五輪 BUG-27 / 第六輪 BUG-29 / 第七輪 BUG-35 的同一個誤用，第四個現場。
 *
 * 現在一律走 `requirePagePermission(collection.page_id, need)`：
 * read 才讀得到、edit 才寫得進去，guest / comment 一律拒寫。
 * `PAGE_NOT_FOUND` 轉成 `COLLECTION_NOT_FOUND`（都是 404，但訊息對得上端點）。
 */
async function loadCollection(
  collectionId: string,
  userId: string,
  need: PagePermission = 'read',
) {
  const row = await repo.findCollectionById(collectionId);
  if (!row) throw new AppError('COLLECTION_NOT_FOUND');
  try {
    await requirePagePermission(userId, row.page_id, need);
  } catch (err) {
    // 看不見載體頁 = 看不見資料庫，不洩漏存在性
    if (err instanceof AppError && err.code === 'PAGE_NOT_FOUND') {
      throw new AppError('COLLECTION_NOT_FOUND');
    }
    throw err;
  }
  return row;
}

/**
 * relation 的**目標**資料庫也要問權限：不然只要對自己的資料庫有 edit，
 * 就能把 relation 指到看不見的資料庫，再靠 rollup / CSV 匯出把對方的標題讀出來。
 */
async function assertRelationTargetsReadable(
  userId: string,
  schema: CollectionSchema,
  selfCollectionId: string,
): Promise<void> {
  const targets = new Set<string>();
  for (const def of Object.values(schema)) {
    if (def?.type !== 'relation') continue;
    const target = (def as { collectionId?: string | null }).collectionId;
    if (target && target !== selfCollectionId) targets.add(target);
  }
  for (const target of targets) {
    await loadCollection(target, userId, 'read');
  }
}

/** 工作區的資料庫清單（relation 的「目標資料庫」下拉） */
export async function listDatabases(
  workspaceId: string,
  userId: string,
): Promise<Array<{ id: string; pageId: string; name: RichText; isInline: boolean }>> {
  const role = await getMemberRole(workspaceId, userId);
  if (!role) throw workspaceNotFound();
  const rows = await repo.listCollectionsForUser(workspaceId, userId);
  // 第八輪：清單也要逐頁過濾（原本只有成員身分 → guest 看得到每個資料庫的名字）
  const index = await buildPermissionIndex(workspaceId, userId, role);
  return rows
    .filter((r) => canSee(index, r.page_id))
    .map((r) => ({
      id: r.id,
      pageId: r.page_id,
      name: r.name ?? [],
      isInline: r.is_inline,
    }));
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

/**
 * 欄位的預設寬度（對齊 Notion：title 276px、其餘 200px）。
 * 前端 `views/types.ts` 的 `defaultPropertyWidth()` 是同一份數字，兩邊要一起改。
 */
export const DEFAULT_TITLE_WIDTH = 276;
export const DEFAULT_PROPERTY_WIDTH = 200;

export function defaultPropertyWidth(property: string): number {
  return property === 'title' ? DEFAULT_TITLE_WIDTH : DEFAULT_PROPERTY_WIDTH;
}

/**
 * 新資料庫的預設表格視圖。
 *
 * ⭐ 一律 `visible: true`。原本是 `visible: i < 5`，所以帶了 6 個以上欄位建出來的
 * 資料庫，第 6 個之後的欄位在表格裡**看不到也編輯不到**（表格沒有「隱藏欄位」的提示，
 * 唯一的入口是 設定 → 編輯屬性 → 重新打開眼睛）。表格的 `.grid` 本來就 `overflow-x: auto`，
 * 欄位太多就橫捲，不需要先砍。功能 QA 第三輪 BUG-10。
 */
function defaultViewFormat(schema: CollectionSchema) {
  return {
    properties: Object.keys(schema).map((property) => ({
      property,
      visible: true,
      width: defaultPropertyWidth(property),
    })),
    tableFreezeColumns: 1,
    tableRowNumbers: false,
  };
}

/**
 * BUG-8：**新增的欄位要接在 `view.format.properties` 的尾端**，順序不能交給 jsonb。
 *
 * 前端的 `visibleProperties()` 對「format 沒列到的欄位」只能用 `Object.keys(schema)`
 * 補在後面，而那是 Postgres jsonb 的 key 排序（先比長度、再比 byte）——
 * 所以依序加 `文字/數字/核取/…` 之後重整，看到的會是 `建立者 建立時間 核取 信箱 …`。
 *
 * 這一支把一個視圖的 properties 重新對齊 schema：
 *   1. 保留既有順序與使用者調過的 width / visible；
 *   2. 丟掉 schema 已經沒有的欄位（delete op 的清理）；
 *   3. `appended`（這一批 add op 產生的 propertyId）一律移到最後；
 *   4. 其他沒被列到的欄位補在 `appended` 之前。
 *
 * 前端 `apps/web/src/features/database/views/types.ts` 的 `alignViewProperties()`
 * 是同一套規則（前端先本地補一份，後端再對所有視圖補一次），兩邊結果一致 ⇒ 冪等。
 */
export function alignViewProperties(
  format: ViewFormat | undefined,
  schema: CollectionSchema,
  appended: readonly string[] = [],
): ViewPropertyFormat[] {
  const configured = format?.properties ?? [];
  const prior = new Map(configured.map((entry) => [entry.property, entry]));
  const appendedIds = [...new Set(appended)];
  const isAppended = new Set(appendedIds);

  const seen = new Set<string>();
  const out: ViewPropertyFormat[] = [];

  for (const entry of configured) {
    if (seen.has(entry.property) || isAppended.has(entry.property)) continue;
    if (!schema[entry.property]) continue;
    seen.add(entry.property);
    out.push(entry);
  }
  for (const property of Object.keys(schema)) {
    if (seen.has(property) || isAppended.has(property)) continue;
    seen.add(property);
    out.push({ property, visible: true, width: defaultPropertyWidth(property) });
  }
  for (const property of appendedIds) {
    if (seen.has(property) || !schema[property]) continue;
    seen.add(property);
    out.push(prior.get(property) ?? { property, visible: true, width: defaultPropertyWidth(property) });
  }
  return out;
}

/** 兩份 properties 一不一樣（一樣就不用打 UPDATE） */
function samePropertyOrder(
  a: ViewPropertyFormat[],
  b: ViewPropertyFormat[] | undefined,
): boolean {
  if (!b || a.length !== b.length) return false;
  return a.every((entry, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      other.property === entry.property &&
      other.visible === entry.visible &&
      other.width === entry.width
    );
  });
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
      // 第八輪：在別人的頁面底下長出新資料庫是**寫入**，要 edit（原本只驗成員身分）
      await requirePagePermission(userId, parentId, 'edit', tx);
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
  await loadCollection(collectionId, userId, 'edit');
  const validated = validateSchema(schema);
  await assertRelationTargetsReadable(userId, validated, collectionId);
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
/* ── relation 的反向欄位（BUG-11） ─────────────────────── */

/**
 * 讀 schema 的小快取：一次 `PATCH /schema` 或一次列寫入裡，
 * 同一個目標 collection 只查一次（交易內的額外查詢要省著用）。
 */
function schemaLoader(tx: Queryable, local: { id: string; schema: () => CollectionSchema }) {
  const cache = new Map<string, CollectionSchema | null>();
  return async (collectionId: string): Promise<CollectionSchema | null> => {
    if (collectionId === local.id) return local.schema();
    if (cache.has(collectionId)) return cache.get(collectionId) ?? null;
    const row = await repo.findCollectionById(collectionId, tx);
    const schema = row ? ((row.schema ?? {}) as CollectionSchema) : null;
    cache.set(collectionId, schema);
    return schema;
  };
}

/**
 * BUG-11：`dualProperty` 指到目標資料庫**不存在**（或不是 relation）的欄位時，
 * 之前會一路寫下去，在目標列的 properties jsonb 裡留下 schema 沒有的孤兒屬性
 * （UI 看不到、CSV 不會輸出，但 relation_edges 已經寫進去了）。
 *
 * 現在在 `PATCH /schema` 當場擋下來（400），訊息直接說是哪個欄位、要怎麼修。
 */
export async function assertDualPropertyExists(
  loadSchema: (collectionId: string) => Promise<CollectionSchema | null>,
  propertyId: string,
  def: FieldDefinition,
): Promise<void> {
  if (def.type !== 'relation' || !def.dualProperty) return;
  if (!def.collectionId) {
    throw new AppError(
      'INVALID_FIELD_TYPE',
      `關聯欄位「${def.name}」設了反向欄位，但沒有指定目標資料庫（collectionId）。`,
    );
  }
  const targetSchema = await loadSchema(def.collectionId);
  if (!targetSchema) {
    throw new AppError('INVALID_FIELD_TYPE', `關聯欄位「${def.name}」的目標資料庫不存在。`);
  }
  const dual = targetSchema[def.dualProperty];
  if (!dual) {
    throw new AppError(
      'INVALID_FIELD_TYPE',
      `目標資料庫裡沒有欄位「${def.dualProperty}」，反向關聯無法建立。` +
        '請改用「在目標資料庫顯示反向欄位」自動建立，或先在目標資料庫加一個關聯欄位。',
    );
  }
  if (dual.type !== 'relation') {
    throw new AppError(
      'INVALID_FIELD_TYPE',
      `目標資料庫的欄位「${dual.name}」不是關聯欄位（目前是 ${dual.type}），不能當反向欄位。`,
    );
  }
  void propertyId;
}

export async function applySchemaOps(
  collectionId: string,
  userId: string,
  ops: SchemaOp[],
): Promise<PatchSchemaResult> {
  const collection = await loadCollection(collectionId, userId, 'edit');
  const original = (collection.schema ?? {}) as CollectionSchema;
  // 第八輪：relation 指到的目標資料庫，自己要看得見才能指過去
  for (const op of ops) {
    const def = (op as { definition?: FieldDefinition }).definition;
    if (def?.type === 'relation') {
      await assertRelationTargetsReadable(userId, { probe: def }, collectionId);
    }
  }

  return withTransaction(async (tx) => {
    let schema: CollectionSchema = { ...original };
    const migrations: SchemaMigrationReport[] = [];
    /** 這一批 ops 新增出來的欄位（BUG-8：要接到每個視圖的 properties 尾端） */
    const addedPropertyIds: string[] = [];
    let schemaShapeChanged = false;
    /** propertyId → 每一列的新值（null = 刪掉 key） */
    const pendingWrites = new Map<string, Map<string, FieldValue | null>>();
    /** BUG-11：這一批要「順便在目標資料庫建反向欄位」的 relation 欄位 */
    const dualCreations: Array<{ propertyId: string; targetCollectionId: string; name: string }> = [];
    /** 這一批動過的 relation 欄位（只驗這些，既有的壞資料不因無關的 op 被擋下） */
    const touchedRelations = new Set<string>();

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
          addedPropertyIds.push(propertyId);
          schemaShapeChanged = true;
          if (op.definition.type === 'relation') touchedRelations.add(propertyId);
          if (op.createDual) {
            if (op.definition.type !== 'relation') {
              throw new AppError('INVALID_FIELD_TYPE', '只有關聯欄位可以自動建立反向欄位');
            }
            if (!op.definition.collectionId) {
              throw new AppError('INVALID_FIELD_TYPE', '要建立反向欄位，請先選擇目標資料庫');
            }
            const name = op.createDual.name.trim();
            if (name === '') {
              throw new AppError('INVALID_FIELD_TYPE', '反向欄位需要一個名稱');
            }
            dualCreations.push({
              propertyId,
              targetCollectionId: op.definition.collectionId,
              name,
            });
          }
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
          if (op.definition.type === 'relation') touchedRelations.add(op.propertyId);
          if (op.createDual) {
            if (op.definition.type !== 'relation') {
              throw new AppError('INVALID_FIELD_TYPE', '只有關聯欄位可以自動建立反向欄位');
            }
            if (!op.definition.collectionId) {
              throw new AppError('INVALID_FIELD_TYPE', '要建立反向欄位，請先選擇目標資料庫');
            }
            const name = op.createDual.name.trim();
            if (name === '') throw new AppError('INVALID_FIELD_TYPE', '反向欄位需要一個名稱');
            dualCreations.push({
              propertyId: op.propertyId,
              targetCollectionId: op.definition.collectionId,
              name,
            });
          }
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
          schemaShapeChanged = true;
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
          if (toDef.type === 'relation') touchedRelations.add(op.propertyId);
          pendingWrites.set(op.propertyId, writes);
          migrations.push(report);
          break;
        }
        default:
          throw new AppError('BAD_REQUEST', '不認得的 schema 操作');
      }
    }

    /**
     * BUG-11 之二：`createDual` —— 在**同一個交易**裡於目標 collection 建一個
     * 反向 relation 欄位，兩邊互指。目標可以是自己（自我關聯）。
     */
    const dualTargets = new Map<string, { schema: CollectionSchema; appended: string[] }>();
    for (const dual of dualCreations) {
      const self = schema[dual.propertyId];
      if (!self || self.type !== 'relation') continue;

      if (dual.targetCollectionId === collectionId) {
        const dualId = generatePropertyId(Object.keys(schema));
        schema[dualId] = {
          name: dual.name,
          type: 'relation',
          collectionId,
          dualProperty: dual.propertyId,
        };
        schema[dual.propertyId] = { ...self, dualProperty: dualId };
        addedPropertyIds.push(dualId);
        schemaShapeChanged = true;
        continue;
      }

      let entry = dualTargets.get(dual.targetCollectionId);
      if (!entry) {
        const target = await repo.findCollectionById(dual.targetCollectionId, tx);
        if (!target) {
          throw new AppError('INVALID_FIELD_TYPE', '找不到要建立反向欄位的目標資料庫');
        }
        if (target.workspace_id !== collection.workspace_id) {
          throw new AppError('INVALID_FIELD_TYPE', '只能關聯同一個工作區裡的資料庫');
        }
        entry = { schema: { ...((target.schema ?? {}) as CollectionSchema) }, appended: [] };
        dualTargets.set(dual.targetCollectionId, entry);
      }
      const dualId = generatePropertyId(Object.keys(entry.schema));
      entry.schema[dualId] = {
        name: dual.name,
        type: 'relation',
        collectionId,
        dualProperty: dual.propertyId,
      };
      entry.appended.push(dualId);
      schema[dual.propertyId] = { ...self, dualProperty: dualId };
    }

    schema = validateSchema(schema);

    for (const [targetId, entry] of dualTargets) {
      const targetSchema = validateSchema(entry.schema);
      await repo.updateCollectionSchema(tx, targetId, targetSchema);
      const targetViews = await repo.listViews(targetId, tx);
      for (const viewRow of targetViews) {
        const format = (viewRow.format ?? {}) as ViewFormat;
        const properties = alignViewProperties(format, targetSchema, entry.appended);
        if (samePropertyOrder(properties, format.properties)) continue;
        await repo.updateView(tx, viewRow.id, { format: { ...format, properties } });
      }
    }

    // BUG-11：dualProperty 指到不存在／型別不對的欄位時，當場 400（不再寫出孤兒資料）
    {
      const loadSchema = schemaLoader(tx, { id: collectionId, schema: () => schema });
      for (const propertyId of touchedRelations) {
        const def = schema[propertyId];
        if (def) await assertDualPropertyExists(loadSchema, propertyId, def);
      }
    }

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

    /**
     * BUG-8：欄位增減之後，把**這個 collection 的每一個視圖**的
     * `format.properties` 重新對齊 schema（新欄位補在尾端、刪掉的欄位清掉）。
     * 不做的話順序會退回 jsonb 的 key 排序，而且每個視圖各自壞。
     */
    if (schemaShapeChanged) {
      const views = await repo.listViews(collectionId, tx);
      for (const viewRow of views) {
        const format = (viewRow.format ?? {}) as ViewFormat;
        const properties = alignViewProperties(format, schema, addedPropertyIds);
        if (samePropertyOrder(properties, format.properties)) continue;
        await repo.updateView(tx, viewRow.id, { format: { ...format, properties } });
      }
    }

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
    collectionId: string;
    rowId: string;
    schema: CollectionSchema;
    before: RowProperties;
    after: RowProperties;
  },
): Promise<void> {
  const loadSchema = schemaLoader(tx, { id: params.collectionId, schema: () => params.schema });
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
    /**
     * BUG-11：目標資料庫的 schema 裡沒有這個欄位（或型別不是 relation）時
     * **當成單向關聯**，不寫反向值。舊資料可能已經存了壞設定，這裡只能靜靜跳過
     * （`PATCH /schema` 會在設定的當下就擋掉新的壞設定）。
     */
    const targetSchema = def.collectionId ? await loadSchema(def.collectionId) : null;
    if (!targetSchema || targetSchema[def.dualProperty]?.type !== 'relation') continue;
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
  const collection = await loadCollection(collectionId, userId, 'edit');
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
      collectionId,
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
  const collection = await loadCollection(collectionId, userId, 'edit');
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
        collectionId,
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
  const collection = await loadCollection(collectionId, userId, 'edit');
  const existing = await repo.findRow(rowId, collectionId);
  if (!existing) throw new AppError('ROW_NOT_FOUND');

  await withTransaction(async (tx) => {
    // 先把 relation 清掉，反向欄位才不會留下指向垃圾桶的幽靈
    await syncRelations(tx, {
      workspaceId: collection.workspace_id,
      collectionId,
      rowId,
      schema: (collection.schema ?? {}) as CollectionSchema,
      before: (existing.properties ?? {}) as RowProperties,
      after: {},
    });
    /**
     * ⭐ 走**與 pages 完全相同的軟刪除路徑**（`softDeleteSubtree`）：
     * 列本身就是 page，它底下的 block 與子頁面要一起進垃圾桶，
     * `GET /api/trash` 才看得到、`POST /api/pages/:id/restore` 才還原得回來
     * （功能 QA 第三輪 §1.6：以前只更新 `pages.deleted_at`，blocks 沒跟著走）。
     */
    const ids = await pagesRepo.collectDescendantIds(rowId, tx);
    await pagesRepo.softDeleteSubtree(tx, ids, userId);
  });
}

/**
 * 表格的**拖曳排序**：把 `rowId` 移到 `afterId` 後面（`afterId: null` = 移到最前面）。
 *
 * 列就是 page，排序真值一樣是 `pages.sort_key`（fractional index），
 * 所以直接沿用 pages 的 `computeSortKey()`：只寫一列，不必整批重排。
 */
export async function reorderRow(
  collectionId: string,
  rowId: string,
  userId: string,
  afterId: string | null,
): Promise<DatabaseRow> {
  const collection = await loadCollection(collectionId, userId, 'edit');
  const schema = (collection.schema ?? {}) as CollectionSchema;
  const existing = await repo.findRow(rowId, collectionId);
  if (!existing) throw new AppError('ROW_NOT_FOUND');
  if (afterId === rowId) throw new AppError('BAD_REQUEST', '不能把一列排到自己後面');
  if (afterId) {
    const target = await repo.findRow(afterId, collectionId);
    if (!target) throw new AppError('ROW_NOT_FOUND', '找不到要插入位置的那一列');
  }

  const updated = await withTransaction(async (tx) => {
    // 注意：pages 的 computeSortKey/listSiblings 會排除 collection_id 不為空的頁面，
    // 資料列的兄弟必須改用「同一個 collection 的列」來算。
    const siblings = await repo.listRowSortKeys(collectionId, tx);
    let sortKey: string;
    if (afterId === null) {
      const first = siblings.find((s) => s.id !== rowId);
      sortKey = generateKeyBetween(null, first ? first.sort_key : null);
    } else {
      const others = siblings.filter((s) => s.id !== rowId);
      const idx = others.findIndex((s) => s.id === afterId);
      const before = idx === -1 ? (others[others.length - 1]?.sort_key ?? null) : others[idx]!.sort_key;
      const after = idx === -1 ? null : (others[idx + 1]?.sort_key ?? null);
      sortKey = generateKeyBetween(before, after);
    }
    const ok = await repo.updateRowSortKey(tx, rowId, collectionId, sortKey);
    if (!ok) throw new AppError('ROW_NOT_FOUND');
    const row = await repo.findRow(rowId, collectionId, tx);
    if (!row) throw new AppError('ROW_NOT_FOUND');
    return row;
  });

  const sources = await loadRollupSources(schema, [updated]);
  return materializeRow(updated, schema, sources, new Date(), schemaHasComputed(schema));
}

export async function duplicateRow(
  collectionId: string,
  rowId: string,
  userId: string,
): Promise<DatabaseRow> {
  const collection = await loadCollection(collectionId, userId, 'edit');
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
  const collection = await loadCollection(collectionId, userId, 'edit');
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
  const collection = await loadCollection(collectionId, userId, 'edit');
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
  await loadCollection(collectionId, userId, 'edit');
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
  const collection = await loadCollection(collectionId, userId, 'edit');
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

/**
 * CSV 的欄序：**依目前視圖的 `format.properties`**（只取可見欄），title 永遠第一欄。
 *
 * 功能 QA 第三輪 §1.3：之前匯出直接走 `Object.keys(schema)`（Postgres 的 jsonb
 * key 排序），所以 `名稱`（title）被排到最後一欄 —— Notion 的 CSV 第一欄一定是 title。
 */
export function csvColumns(schema: CollectionSchema, format: ViewFormat | undefined): string[] {
  const formatProps = format?.properties ?? [];
  const visible = formatProps.filter((p) => p.visible !== false).map((p) => p.property);
  const columns = (visible.length > 0 ? visible : Object.keys(schema)).filter((id) => schema[id]);
  const titleAt = columns.indexOf('title');
  if (titleAt > 0) columns.splice(titleAt, 1);
  if (titleAt !== 0 && schema.title) columns.unshift('title');
  return columns;
}

/**
 * CSV 的 relation 欄位要顯示**目標列的標題**，所以先把這一批會用到的 pageId
 * 一次撈回來（一次查詢，不是每格一次）。
 */
async function loadRelationTitles(
  schema: CollectionSchema,
  columns: readonly string[],
  records: readonly repo.RowRecord[],
): Promise<Map<string, string>> {
  const relationColumns = columns.filter((id) => schema[id]?.type === 'relation');
  if (relationColumns.length === 0) return new Map();
  const ids = new Set<string>();
  for (const record of records) {
    const props = (record.properties ?? {}) as RowProperties;
    for (const column of relationColumns) {
      const value = props[column];
      if (value && value.type === 'relation') for (const id of value.pageIds) ids.add(id);
    }
  }
  if (ids.size === 0) return new Map();
  const rows = await repo.findRowsByIds([...ids].slice(0, MAX_EXPORT_ROWS));
  return new Map(rows.map((r) => [r.id, richTextToPlainText(r.title ?? [])]));
}

export async function exportCsv(
  collectionId: string,
  userId: string,
  viewId?: string,
): Promise<string> {
  const collection = await loadCollection(collectionId, userId);
  const schema = (collection.schema ?? {}) as CollectionSchema;
  /**
   * 沒帶 viewId 時退回**第一個視圖**，而不是「沒有視圖」。
   * 不這樣做的話欄序會退回 `Object.keys(schema)`（Postgres 的 jsonb key 排序），
   * title 會被排到最後 —— Notion 的 CSV 第一欄一定是 title。
   */
  const view = viewId
    ? await repo.findView(viewId, collectionId)
    : ((await repo.listViews(collectionId))[0] ?? null);
  const ctx = defaultQueryContext();
  const compiled = compileViewQuery(schema, view?.query ?? {}, ctx);

  const columns = csvColumns(schema, view?.format as ViewFormat | undefined);

  const records = await repo.streamAllRows(
    collectionId,
    compiled.where,
    compiled.sort.order,
    MAX_EXPORT_ROWS,
  );
  const sources = await loadRollupSources(schema, records);
  const hasComputed = schemaHasComputed(schema);
  const relationTitles = await loadRelationTitles(schema, columns, records);

  const lines: string[] = [
    columns.map((id) => csvCell(schema[id]?.name ?? id)).join(','),
  ];
  for (const record of records) {
    const row = materializeRow(record, schema, sources, ctx.now, hasComputed);
    const cells = columns.map((id) => {
      const def = schema[id];
      if (!def) return '';
      if (def.type === 'relation') {
        const value = row.properties[id];
        if (!value || value.type !== 'relation') return '';
        // relation 匯出目標列的**標題**（Notion 就是這樣），不是 pageId
        return csvCell(
          value.pageIds.map((pid) => relationTitles.get(pid) ?? pid).join(', '),
        );
      }
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
