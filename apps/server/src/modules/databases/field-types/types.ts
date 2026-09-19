import type {
  AggregationFunction,
  CollectionSchema,
  FieldDefinition,
  FieldType,
  FieldValue,
  FilterOperator,
  SelectColor,
} from '@kennote/shared-types';
import { AppError } from '../../../lib/errors.js';
import { sql, type Sql } from '../../../db/sql.js';

/**
 * 後端 Field Type Registry（04 §10.2）。
 *
 * 00-README §5 風險三：「屬性值存在 JSONB，schema 定義在另一張表 ——
 * 兩邊型別不一致時 filter/sort 會**靜默**給出錯誤結果」。
 * 解法就是這張表：每種欄位型別把
 *   「儲存形狀 / 驗證器 / 預設值 / SQL 投影式 / 可用運算子 / 比較子 /
 *     排序鍵 / 分組鍵 / CSV 字串化 / 型別轉換」
 * 集中定義在一個檔案，不讓 if-else 散落各處。
 *
 * 新增一種欄位型別 = 新增一個 defineFieldType()，
 * filter / sort / group / aggregation / CSV 匯出全部自動支援。
 */

/** 值的比較語意分類。aggregation 與 cursor 編碼靠這個決定怎麼轉型 */
export type ValueKind = 'text' | 'number' | 'date' | 'boolean' | 'array';

export interface ValidateConfigContext {
  /** 完整 schema（formula 編譯、rollup 的 relation 檢查需要） */
  schema: CollectionSchema;
  propertyId: string;
}

export interface FilterSqlContext {
  propertyId: string;
  def: FieldDefinition;
  operator: FilterOperator;
  value: unknown;
  /** 純量投影式（= toSqlExpr 的結果），大多數型別用這個就夠 */
  expr: Sql;
  /** 相對日期一律在產生 SQL 時才展開（03 §6.5）；這是那個「現在」 */
  now: Date;
  timeZone: string;
}

export interface GroupLabel {
  label: string;
  color?: SelectColor;
}

export interface ServerFieldType {
  type: FieldType;
  label: string;
  kind: ValueKind;

  /** 值不存在 properties 裡（系統欄位 / 計算欄位） */
  computed: boolean;
  /** 能不能當 Board 的分組依據 */
  groupable: boolean;
  sortable: boolean;
  /**
   * 能不能直接在 SQL 裡表達。false 的型別（formula / rollup）
   * 由 service 在取回資料後於記憶體中 filter/sort（見 ADR 0003 的取捨）。
   */
  sqlCapable: boolean;

  /** 驗證欄位定義本身（schema 裡的那一份） */
  validateConfig(def: unknown, ctx: ValidateConfigContext): FieldDefinition;
  /** 新列的預設值。null = 不寫入任何 key */
  defaultValue(def: FieldDefinition): FieldValue | null;
  /** 正規化單一儲存格的值。回 null 代表「空」→ 呼叫端刪掉整個 key（03 §6.4） */
  normalize(value: unknown, def: FieldDefinition): FieldValue | null;

  /** SQL 投影式：把這個欄位投影成可比較的純量。propertyId 一律走參數化 */
  toSqlExpr(propertyId: string, def: FieldDefinition): Sql;
  /** 覆寫預設的 filter SQL（容器型別 / 日期相對值用） */
  toFilterSql?(ctx: FilterSqlContext): Sql;
  /** 分組鍵的 SQL（預設等於 toSqlExpr） */
  toGroupKeySql?(propertyId: string, def: FieldDefinition): Sql;

  /** 支援的篩選運算子（UI 讀這個，不寫 if (type === 'select')） */
  filterOperators: FilterOperator[];
  /** 聚合列可選的函式 */
  aggregations: AggregationFunction[];

  /** 記憶體排序用的比較子（formula/rollup 與前端共用同一語意） */
  compare(a: FieldValue | undefined, b: FieldValue | undefined, def: FieldDefinition): number;
  /** 分組鍵（multiSelect 之後若要一張卡出現在多組，回多個 key） */
  groupKeys(value: FieldValue | undefined, def: FieldDefinition): Array<string | null>;
  /** 分組標題的顯示文字與顏色 */
  groupLabel(key: string | null, def: FieldDefinition): GroupLabel;

  /** 搜尋索引 / CSV 匯出用的純文字 */
  toPlainText(value: FieldValue | undefined, def: FieldDefinition): string;
  /** CSV 匯入 / 快捷輸入 */
  fromPlainText?(text: string, def: FieldDefinition): FieldValue | null;
  /** 換欄位型別時盡量保住資料（02 §4.3.1 的轉換矩陣） */
  coerceFrom?(
    value: FieldValue | undefined,
    fromType: FieldType,
    def: FieldDefinition,
  ): FieldValue | null;
}

const registry = new Map<FieldType, ServerFieldType>();

export function defineFieldType(def: ServerFieldType): void {
  if (registry.has(def.type)) throw new Error(`Field type 重複註冊：${def.type}`);
  registry.set(def.type, def);
}

export function getFieldType(type: string): ServerFieldType {
  const def = registry.get(type as FieldType);
  if (!def) throw new AppError('INVALID_FIELD_TYPE', `不支援的欄位型別：${type}`, { type });
  return def;
}

export function hasFieldType(type: string): boolean {
  return registry.has(type as FieldType);
}

export function listFieldTypes(): ServerFieldType[] {
  return [...registry.values()];
}

export function __resetFieldTypes(): void {
  registry.clear();
}

/* ── 給各型別共用的 SQL 小工具 ─────────────────────────── */

/** properties -> '<propertyId>'。propertyId 永遠是參數，不進 SQL 文字 */
export function propJson(propertyId: string): Sql {
  return sql`(p.properties -> ${propertyId})`;
}

/** properties -> '<propertyId>' ->> '<key>' */
export function propText(propertyId: string, key: string): Sql {
  return sql`(p.properties -> ${propertyId} ->> ${key})`;
}

/** 預設比較子：null 一律排最後（與 SQL 的 NULLS LAST 一致） */
export function compareNullable<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  cmp: (x: T, y: T) => number,
): number {
  const aEmpty = a === null || a === undefined;
  const bEmpty = b === null || b === undefined;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  return cmp(a, b);
}

export function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hant');
}
