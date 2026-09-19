/**
 * 前端 Field Type Registry（04 §10.2）。
 *
 * 這是整個 database 模組的擴充點：每種欄位型別把
 *   「顯示 / 編輯 / 設定 / 篩選輸入 / 比較 / 分組 / 純文字化」
 * 集中在**一個資料夾**裡，Table / Board / List / Gallery / Calendar /
 * FilterBuilder / SortBuilder / PropertyList 全部只讀這張表，
 * 一行 `if (type === 'select')` 都不會出現。
 *
 * 新增一種欄位型別的完整步驟（README 有更詳細的版本）：
 *   1. packages/shared-types/src/database.ts 的 FIELD_TYPES 加一個 key
 *   2. apps/server/.../field-types/ 加一個檔案
 *   3. 這裡的 fields/<type>/ 加一個資料夾（Cell / Editor / Config / ops）
 *   4. fields/index.ts 加一行 import
 * 其他檔案一行都不用改 —— rating 型別就是這條規則的實際證明。
 */
import type { FC } from 'react';
import type {
  AggregationFunction,
  CollectionSchema,
  DatabaseRow,
  FieldDefinition,
  FieldType,
  FieldValue,
  FilterOperator,
  SelectColor,
} from '@kennote/shared-types';

export interface CellProps {
  propertyId: string;
  value: FieldValue | undefined;
  def: FieldDefinition;
  row: DatabaseRow;
  /** Board 卡片 / Gallery 卡片的精簡呈現 */
  compact?: boolean;
}

export interface EditorProps {
  propertyId: string;
  value: FieldValue | undefined;
  def: FieldDefinition;
  row?: DatabaseRow;
  /** 送出新值（未正規化的原始輸入，後端 registry 會 normalize） */
  onChange: (value: unknown) => void;
  onClose: () => void;
  autoFocus?: boolean;
}

export interface ConfigProps {
  propertyId: string;
  def: FieldDefinition;
  /** 整個 schema，relation / rollup / formula 的設定面板需要 */
  schema: CollectionSchema;
  onChange: (next: FieldDefinition) => void;
}

export interface FilterInputProps {
  operator: FilterOperator;
  value: unknown;
  def: FieldDefinition;
  onChange: (value: unknown) => void;
}

export interface GroupKeyLabel {
  label: string;
  color?: SelectColor;
}

export interface FieldTypeDefinition {
  type: FieldType;
  label: string;
  /** icons.tsx 的 key */
  icon: string;
  group: 'basic' | 'advanced' | 'system';

  /* ── 能力宣告（決定 UI 顯示哪些選項，取代 if-else）── */
  sortable: boolean;
  filterable: boolean;
  groupable: boolean;
  /** formula / rollup / createdTime… → 不可直接編輯 */
  computed: boolean;
  /** 點一下就切換，不進編輯態（checkbox / rating） */
  editInline?: boolean;
  /**
   * 編輯器要長在哪裡：
   *   'inline'  → 直接把輸入框蓋在儲存格上（文字、數字）
   *   'popover' → 開浮層（選項、日期、人員、關聯…）預設值
   */
  editorSurface?: 'inline' | 'popover';

  /* ── 設定與值 ── */
  defaultConfig: (name: string) => FieldDefinition;
  defaultValue: FieldValue | null;

  /* ── 渲染 ── */
  Cell: FC<CellProps>;
  Editor: FC<EditorProps> | null;
  Config: FC<ConfigProps> | null;

  /* ── 篩選 ── */
  filterOperators: FilterOperator[];
  FilterInput: FC<FilterInputProps>;
  aggregations: AggregationFunction[];

  /* ── 排序與分組 ── */
  compare: (a: FieldValue | undefined, b: FieldValue | undefined, def: FieldDefinition) => number;
  groupKeys: (value: FieldValue | undefined, def: FieldDefinition) => Array<string | null>;
  groupLabel: (key: string | null, def: FieldDefinition) => GroupKeyLabel;

  /* ── 轉換 ── */
  toPlainText: (value: FieldValue | undefined, def: FieldDefinition) => string;
}

const registry = new Map<FieldType, FieldTypeDefinition>();

export function registerFieldType(def: FieldTypeDefinition): void {
  registry.set(def.type, def);
}

export function getFieldType(type: FieldType | string): FieldTypeDefinition {
  const def = registry.get(type as FieldType);
  if (!def) {
    const fallback = registry.get('text');
    if (fallback) return fallback;
    throw new Error(`未註冊的欄位型別：${type}`);
  }
  return def;
}

export function hasFieldType(type: string): boolean {
  return registry.has(type as FieldType);
}

export function listFieldTypes(): FieldTypeDefinition[] {
  return [...registry.values()];
}

/** 型別選單用：依 group 分組（Notion 的「基本 / 進階 / 系統」） */
export function fieldTypeGroups(): Array<{ group: string; label: string; types: FieldTypeDefinition[] }> {
  const labels: Record<string, string> = { basic: '基本', advanced: '進階', system: '系統' };
  return (['basic', 'advanced', 'system'] as const).map((group) => ({
    group,
    label: labels[group] as string,
    types: listFieldTypes().filter((f) => f.group === group),
  }));
}
