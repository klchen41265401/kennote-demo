import type { FieldDefinition, FieldType, FieldValue, FilterOperator } from '@kennote/shared-types';
import { AppError } from '../../../lib/errors.js';
import type { Sql } from '../../../db/sql.js';

/**
 * 後端 Field Type Registry（04 §10.2）。
 *
 * 00-README §5 風險三：「屬性值存在 JSONB，schema 定義在另一張表 ——
 * 兩邊型別不一致時 filter/sort 會**靜默**給出錯誤結果」。
 * 解法就是這張表：每種欄位型別把「儲存形狀 / 驗證器 / SQL 投影式 / 排序鍵 / 預設值」
 * 集中定義在一個檔案，不讓 if-else 散落各處。
 *
 * 新增一種欄位型別 = 新增一個 defineFieldType()，filter/sort/匯出全部自動支援。
 */
export interface ServerFieldType {
  type: FieldType;
  /** 驗證欄位定義本身（schema 裡的那一份） */
  validateConfig(def: unknown): FieldDefinition;
  /** 正規化單一儲存格的值。回 null 代表「空」→ 呼叫端刪掉整個 key（03 §6.4） */
  normalize(value: unknown, def: FieldDefinition): FieldValue | null;
  /** SQL 投影式：把這個欄位投影成可比較的純量。propertyId 一律走參數化 */
  toSqlExpr(propertyId: string, def: FieldDefinition, sql: SqlTagFn): Sql;
  /** 支援的篩選運算子（UI 讀這個，不寫 if (type === 'select')） */
  filterOperators: FilterOperator[];
  /** 搜尋索引 / CSV 匯出用的純文字 */
  toPlainText(value: FieldValue | undefined, def: FieldDefinition): string;
}

export type SqlTagFn = typeof import('../../../db/sql.js').sql;

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
