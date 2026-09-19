/**
 * 計算欄位：系統欄位投影、rollup 聚合、formula 求值。
 *
 * 03 §6.4 建議「寫入時標 stale、背景 worker 重算」；本專案 M4 先做
 * **查詢時計算**（每次取回 ≤ pageSize 筆，rollup 的目標列一次批次載入，
 * 沒有 N+1）。之後要換成背景重算，只需要把 computeRowProperties 的呼叫點
 * 從 service 移到 worker，形狀不必改。取捨寫在 docs/adr/0003。
 */
import type {
  AggregationFunction,
  CollectionSchema,
  FieldDefinition,
  RowProperties,
} from '@kennote/shared-types';
import {
  FormulaError,
  evaluateFieldFormula,
  fieldValueToFormulaValue,
  serializeFormulaValue,
  type FormulaValue,
} from '@kennote/shared-types';

export interface RollupSource {
  /** 目標 collection 的 schema */
  schema: CollectionSchema;
  /** 目標列 id → 欄位值 */
  rows: Map<string, RowProperties>;
}

/** key = 本 collection 上的 relation propertyId */
export type RollupSources = Map<string, RollupSource>;

export interface RowMeta {
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

function toNumber(v: FormulaValue): number | null {
  if (v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isBlank(v: FormulaValue): boolean {
  return v === null || v === '' || (typeof v === 'number' && Number.isNaN(v));
}

/** rollup / aggregation 列共用的聚合語意（SQL 版在 query-builder，兩邊必須一致） */
export function aggregateValues(
  fn: AggregationFunction,
  values: FormulaValue[],
): { value: string | number | boolean | null; items?: Array<string | number | boolean | null> } {
  const total = values.length;
  const notEmpty = values.filter((v) => !isBlank(v));
  const numbers = notEmpty.map(toNumber).filter((n): n is number => n !== null);
  const sorted = [...numbers].sort((a, b) => a - b);

  switch (fn) {
    case 'none':
      return { value: null };
    case 'count':
      return { value: total };
    case 'countValues':
    case 'countNotEmpty':
      return { value: notEmpty.length };
    case 'countEmpty':
      return { value: total - notEmpty.length };
    case 'countUnique':
      return { value: new Set(notEmpty.map((v) => String(serializeFormulaValue(v)))).size };
    case 'percentEmpty':
      return { value: total === 0 ? 0 : Math.round(((total - notEmpty.length) / total) * 1000) / 10 };
    case 'percentNotEmpty':
      return { value: total === 0 ? 0 : Math.round((notEmpty.length / total) * 1000) / 10 };
    case 'sum':
      return { value: numbers.reduce((s, n) => s + n, 0) };
    case 'average':
      return { value: numbers.length === 0 ? null : numbers.reduce((s, n) => s + n, 0) / numbers.length };
    case 'median': {
      if (sorted.length === 0) return { value: null };
      const mid = Math.floor(sorted.length / 2);
      return {
        value:
          sorted.length % 2 === 1
            ? (sorted[mid] as number)
            : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2,
      };
    }
    case 'min':
      return { value: sorted.length === 0 ? null : (sorted[0] as number) };
    case 'max':
      return { value: sorted.length === 0 ? null : (sorted[sorted.length - 1] as number) };
    case 'range':
      return {
        value:
          sorted.length === 0 ? null : (sorted[sorted.length - 1] as number) - (sorted[0] as number),
      };
    case 'earliestDate':
    case 'latestDate': {
      const dates = notEmpty
        .map((v) => (v instanceof Date ? v.toISOString() : String(serializeFormulaValue(v))))
        .filter((s) => !Number.isNaN(new Date(s).getTime()))
        .sort();
      if (dates.length === 0) return { value: null };
      return { value: fn === 'earliestDate' ? (dates[0] as string) : (dates[dates.length - 1] as string) };
    }
    case 'checked':
      return { value: values.filter((v) => v === true).length };
    case 'unchecked':
      return { value: values.filter((v) => v !== true).length };
    case 'percentChecked':
      return {
        value: total === 0 ? 0 : Math.round((values.filter((v) => v === true).length / total) * 1000) / 10,
      };
    case 'showOriginal':
      return {
        value: notEmpty.length === 0 ? null : serializeFormulaValue(notEmpty[0] as FormulaValue),
        items: notEmpty.map((v) => serializeFormulaValue(v)),
      };
    default:
      return { value: null };
  }
}

function relationTargets(
  def: FieldDefinition & { type: 'rollup' },
  properties: RowProperties,
  sources: RollupSources,
): FormulaValue[] {
  if (!def.relationProperty) return [];
  const source = sources.get(def.relationProperty);
  const relation = properties[def.relationProperty];
  if (!source || !relation || relation.type !== 'relation') return [];
  return relation.pageIds.map((id) => {
    const target = source.rows.get(id);
    if (!target) return null;
    if (!def.targetProperty || def.targetProperty === 'title') {
      const title = target.title;
      return title && (title.type === 'title' || title.type === 'text') ? title.plainText : null;
    }
    return fieldValueToFormulaValue(target[def.targetProperty], source.schema[def.targetProperty]);
  });
}

/**
 * 算出一列的完整 properties（原始值 + 系統欄位 + rollup + formula）。
 * 不修改輸入物件。
 */
export function computeRowProperties(
  schema: CollectionSchema,
  stored: RowProperties,
  meta: RowMeta,
  sources: RollupSources,
  now: Date,
): RowProperties {
  const out: RowProperties = { ...stored };

  // 1) 系統欄位：值不存在 properties，由 pages 的實體欄位投影（03 §6.3）
  for (const [propertyId, def] of Object.entries(schema)) {
    switch (def?.type) {
      case 'createdTime':
        out[propertyId] = { type: 'createdTime', start: meta.createdAt };
        break;
      case 'lastEditedTime':
        out[propertyId] = { type: 'lastEditedTime', start: meta.updatedAt };
        break;
      case 'createdBy':
        out[propertyId] = { type: 'createdBy', userIds: meta.createdBy ? [meta.createdBy] : [] };
        break;
      case 'lastEditedBy':
        out[propertyId] = {
          type: 'lastEditedBy',
          userIds: meta.updatedBy ? [meta.updatedBy] : [],
        };
        break;
      default:
        break;
    }
  }

  const computedAt = now.toISOString();

  // 2) rollup：沿 relation 聚合目標 collection 的欄位
  for (const [propertyId, def] of Object.entries(schema)) {
    if (def?.type !== 'rollup') continue;
    const values = relationTargets(def, out, sources);
    const result = aggregateValues(def.function ?? 'count', values);
    out[propertyId] = {
      type: 'rollup',
      value: result.value,
      valueType: typeof result.value === 'number' ? 'number' : 'string',
      ...(result.items ? { items: result.items } : {}),
      computedAt,
    };
  }

  // 3) formula：可能互相引用，用 visiting 集合擋住環（compile 階段已擋過一次，這是防呆）
  const memo = new Map<string, FormulaValue>();
  const visiting = new Set<string>();

  function resolve(propertyId: string): FormulaValue {
    if (memo.has(propertyId)) return memo.get(propertyId) as FormulaValue;
    const def = schema[propertyId];
    if (!def || def.type !== 'formula') {
      return fieldValueToFormulaValue(out[propertyId], def);
    }
    if (visiting.has(propertyId)) {
      throw new FormulaError('CYCLE', `公式「${def.name}」出現循環引用`);
    }
    visiting.add(propertyId);
    try {
      const value = evaluateFieldFormula(def, {
        schema,
        properties: out,
        now,
        resolveComputed: resolve,
      });
      memo.set(propertyId, value);
      return value;
    } finally {
      visiting.delete(propertyId);
    }
  }

  for (const [propertyId, def] of Object.entries(schema)) {
    if (def?.type !== 'formula') continue;
    try {
      const value = resolve(propertyId);
      out[propertyId] = {
        type: 'formula',
        value: serializeFormulaValue(value),
        valueType: def.resultType ?? 'any',
        error: null,
        computedAt,
      };
    } catch (err) {
      out[propertyId] = {
        type: 'formula',
        value: null,
        valueType: def.resultType ?? 'any',
        error: err instanceof Error ? err.message : '公式計算失敗',
        computedAt,
      };
    }
  }

  return out;
}

/** 這個 schema 需不需要跑計算（沒有計算欄位就整段跳過，省掉一次 map） */
export function schemaHasComputed(schema: CollectionSchema): boolean {
  return Object.values(schema).some(
    (def) =>
      def &&
      ['formula', 'rollup', 'createdTime', 'lastEditedTime', 'createdBy', 'lastEditedBy'].includes(
        def.type,
      ),
  );
}

export function schemaRelationProperties(schema: CollectionSchema): string[] {
  const needed = new Set<string>();
  for (const def of Object.values(schema)) {
    if (def?.type === 'rollup' && def.relationProperty) needed.add(def.relationProperty);
  }
  return [...needed];
}
