import type { FormulaAst, FormulaType } from './formula/ast.js';
import type { RichText } from './richtext.js';

/**
 * Database（collection）型別。對應 03 §6.3–6.6，但欄位一律 camelCase
 * （與 BlockType union 的命名一致；理由見 docs/adr/0002）。
 *
 * ⚠️ 這個檔案是 **field type registry 的唯一事實來源**：
 *   前端（apps/web/src/features/database/fields）與後端
 *   （apps/server/src/modules/databases/field-types）用同一組 key，
 *   新增一種欄位型別 = 這裡加一個 FieldType + 兩邊各註冊一次。
 *   決策與理由見 docs/adr/0003-database-registry.md。
 */

/** 全部欄位型別。第一批 8 種（+title）是 P0，其餘依 01 §5.2 的優先級補上 */
export const FIELD_TYPES = [
  // P0：第一批
  'title',
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
  'person',
  // P0/P1：字串家族與檔案
  'email',
  'phone',
  'files',
  // 自訂型別的示範（04 §10.2 的驗收項）
  'rating',
  // 系統欄位（值由 pages 的實體欄位投影，不存在 properties）
  'createdTime',
  'lastEditedTime',
  'createdBy',
  'lastEditedBy',
  // 進階：跨庫與計算
  'relation',
  'rollup',
  'formula',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export function isFieldType(v: unknown): v is FieldType {
  return typeof v === 'string' && (FIELD_TYPES as readonly string[]).includes(v);
}

/** 給 UI 的型別選單（Notion 的名稱 + icon key）。前後端共用，避免兩邊翻譯不一致 */
export interface FieldTypeMeta {
  label: string;
  icon: string;
  /** 型別選單的分組 */
  group: 'basic' | 'advanced' | 'system';
  /** 值由系統計算，不可直接編輯 */
  computed: boolean;
}

export const FIELD_TYPE_META: Record<FieldType, FieldTypeMeta> = {
  title: { label: '標題', icon: 'title', group: 'basic', computed: false },
  text: { label: '文字', icon: 'text', group: 'basic', computed: false },
  number: { label: '數字', icon: 'number', group: 'basic', computed: false },
  select: { label: '單選', icon: 'select', group: 'basic', computed: false },
  multiSelect: { label: '多選', icon: 'multiSelect', group: 'basic', computed: false },
  date: { label: '日期', icon: 'date', group: 'basic', computed: false },
  person: { label: '人員', icon: 'person', group: 'basic', computed: false },
  files: { label: '檔案與媒體', icon: 'files', group: 'basic', computed: false },
  checkbox: { label: '核取方塊', icon: 'checkbox', group: 'basic', computed: false },
  url: { label: '網址', icon: 'url', group: 'basic', computed: false },
  email: { label: '電子郵件', icon: 'email', group: 'basic', computed: false },
  phone: { label: '電話', icon: 'phone', group: 'basic', computed: false },
  rating: { label: '星等', icon: 'rating', group: 'basic', computed: false },
  formula: { label: '公式', icon: 'formula', group: 'advanced', computed: true },
  relation: { label: '關聯', icon: 'relation', group: 'advanced', computed: false },
  rollup: { label: '匯總', icon: 'rollup', group: 'advanced', computed: true },
  createdTime: { label: '建立時間', icon: 'createdTime', group: 'system', computed: true },
  lastEditedTime: { label: '最後編輯時間', icon: 'lastEditedTime', group: 'system', computed: true },
  createdBy: { label: '建立者', icon: 'createdBy', group: 'system', computed: true },
  lastEditedBy: { label: '最後編輯者', icon: 'lastEditedBy', group: 'system', computed: true },
};

export type SelectColor =
  | 'default'
  | 'gray'
  | 'brown'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'red';

export const SELECT_COLORS: SelectColor[] = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
];

export interface SelectOption {
  id: string;
  value: string;
  color: SelectColor;
}

export type NumberFormat =
  | 'number'
  | 'numberWithCommas'
  | 'percent'
  | 'currencyTwd'
  | 'currencyUsd'
  | 'yen'
  | 'euro';

/** 匯總（rollup）與聚合列（aggregation row）共用同一組函式名 */
export const AGGREGATION_FUNCTIONS = [
  'none',
  'count',
  'countValues',
  'countUnique',
  'countEmpty',
  'countNotEmpty',
  'percentEmpty',
  'percentNotEmpty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'earliestDate',
  'latestDate',
  'checked',
  'unchecked',
  'percentChecked',
  'showOriginal',
] as const;

export type AggregationFunction = (typeof AGGREGATION_FUNCTIONS)[number];

export const AGGREGATION_LABELS: Record<AggregationFunction, string> = {
  none: '無',
  count: '全部計數',
  countValues: '值的數量',
  countUnique: '相異值',
  countEmpty: '空白數',
  countNotEmpty: '非空白數',
  percentEmpty: '空白百分比',
  percentNotEmpty: '非空白百分比',
  sum: '總和',
  average: '平均',
  median: '中位數',
  min: '最小值',
  max: '最大值',
  range: '全距',
  earliestDate: '最早日期',
  latestDate: '最晚日期',
  checked: '已勾選',
  unchecked: '未勾選',
  percentChecked: '已勾選百分比',
  showOriginal: '顯示原值',
};

interface FieldDefinitionBase {
  name: string;
  description?: string;
  /** 由系統維護，UI 不可編輯值 */
  readonly?: boolean;
}

export interface FormulaFieldConfig {
  /** 使用者看到／編輯的原始字串。求值一律走 ast（03 §6.3） */
  expression: string;
  ast: FormulaAst | null;
  resultType: FormulaType;
  /** 相依的 propertyId，循環引用偵測與增量重算用 */
  dependsOn: string[];
  /** 編譯失敗時保留錯誤訊息，前端直接顯示在儲存格 */
  error?: string | null;
}

export type FieldDefinition =
  | (FieldDefinitionBase & { type: 'title' })
  | (FieldDefinitionBase & { type: 'text' })
  | (FieldDefinitionBase & {
      type: 'number';
      numberFormat?: NumberFormat;
      precision?: number | null;
    })
  | (FieldDefinitionBase & { type: 'select'; options: SelectOption[] })
  | (FieldDefinitionBase & { type: 'multiSelect'; options: SelectOption[] })
  | (FieldDefinitionBase & {
      type: 'date';
      dateFormat?: string;
      timeFormat?: string;
      includeTimeDefault?: boolean;
    })
  | (FieldDefinitionBase & { type: 'checkbox' })
  | (FieldDefinitionBase & { type: 'url' })
  | (FieldDefinitionBase & { type: 'email' })
  | (FieldDefinitionBase & { type: 'phone' })
  | (FieldDefinitionBase & { type: 'person'; allowMultiple?: boolean })
  | (FieldDefinitionBase & { type: 'files'; maxFiles?: number })
  | (FieldDefinitionBase & { type: 'rating'; max?: number; icon?: 'star' | 'heart' | 'number' })
  | (FieldDefinitionBase & { type: 'createdTime'; dateFormat?: string })
  | (FieldDefinitionBase & { type: 'lastEditedTime'; dateFormat?: string })
  | (FieldDefinitionBase & { type: 'createdBy' })
  | (FieldDefinitionBase & { type: 'lastEditedBy' })
  | (FieldDefinitionBase & {
      type: 'relation';
      /** 目標 collection */
      collectionId: string | null;
      /** 目標 collection 上的反向欄位 id；單向 relation 為 null */
      dualProperty?: string | null;
      allowMultiple?: boolean;
      limit?: number | null;
    })
  | (FieldDefinitionBase & {
      type: 'rollup';
      /** 沿哪個 relation 欄位走（本 collection 上的 propertyId） */
      relationProperty: string | null;
      /** 目標 collection 上要聚合的欄位 id */
      targetProperty: string | null;
      function: AggregationFunction;
    })
  | (FieldDefinitionBase & { type: 'formula' } & FormulaFieldConfig);

/** key = propertyId（'title' 或 4~16 碼短碼），value = 欄位定義 */
export type CollectionSchema = Record<string, FieldDefinition>;

export interface FileRef {
  fileId?: string;
  externalUrl?: string;
  name: string;
}

/** 每一列的欄位值（03 §6.4）。清空 = 刪掉整個 key */
export type FieldValue =
  | { type: 'title'; richText: RichText; plainText: string }
  | { type: 'text'; richText: RichText; plainText: string }
  | { type: 'number'; number: number | null }
  | { type: 'select'; optionId: string | null }
  | { type: 'multiSelect'; optionIds: string[] }
  | {
      type: 'date';
      start: string;
      end: string | null;
      includeTime: boolean;
      timeZone?: string | null;
    }
  | { type: 'checkbox'; checkbox: boolean }
  | { type: 'url'; url: string | null }
  | { type: 'email'; email: string | null }
  | { type: 'phone'; phone: string | null }
  | { type: 'person'; userIds: string[] }
  | { type: 'files'; files: FileRef[] }
  | { type: 'rating'; rating: number }
  | { type: 'relation'; pageIds: string[] }
  | { type: 'createdTime'; start: string }
  | { type: 'lastEditedTime'; start: string }
  | { type: 'createdBy'; userIds: string[] }
  | { type: 'lastEditedBy'; userIds: string[] }
  | {
      type: 'rollup';
      value: string | number | boolean | null;
      valueType: FormulaType;
      /** showOriginal 時回傳多筆原值 */
      items?: Array<string | number | boolean | null>;
      computedAt?: string;
    }
  | {
      type: 'formula';
      value: string | number | boolean | null;
      valueType: FormulaType;
      error?: string | null;
      computedAt?: string;
    };

export type RowProperties = Record<string, FieldValue>;

export interface Collection {
  id: string;
  workspaceId: string;
  /** 承載這個 collection 的頁面（is_database = true） */
  pageId: string;
  name: RichText;
  description: RichText;
  schema: CollectionSchema;
  isInline: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const VIEW_TYPES = ['table', 'board', 'list', 'gallery', 'calendar', 'timeline'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const VIEW_TYPE_LABELS: Record<ViewType, string> = {
  table: '表格',
  board: '看板',
  list: '清單',
  gallery: '圖庫',
  calendar: '日曆',
  timeline: '時程表',
};

export type FilterOperator =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'doesNotContain'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'equals'
  | 'doesNotEqual'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqualTo'
  | 'lessThanOrEqualTo'
  | 'isAnyOf'
  | 'isNoneOf'
  | 'isBefore'
  | 'isAfter'
  | 'isOnOrBefore'
  | 'isOnOrAfter'
  | 'isWithin';

export const FILTER_OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: '是',
  isNot: '不是',
  contains: '包含',
  doesNotContain: '不包含',
  startsWith: '開頭是',
  endsWith: '結尾是',
  isEmpty: '為空',
  isNotEmpty: '不為空',
  equals: '等於',
  doesNotEqual: '不等於',
  greaterThan: '大於',
  lessThan: '小於',
  greaterThanOrEqualTo: '大於等於',
  lessThanOrEqualTo: '小於等於',
  isAnyOf: '是其中之一',
  isNoneOf: '不是其中任何一個',
  isBefore: '早於',
  isAfter: '晚於',
  isOnOrBefore: '早於或等於',
  isOnOrAfter: '晚於或等於',
  isWithin: '在區間內',
};

/** 不需要值的運算子（UI 不顯示值編輯器；SQL 也不取 value） */
export const VALUELESS_OPERATORS: FilterOperator[] = ['isEmpty', 'isNotEmpty'];

export const RELATIVE_DATES = [
  'today',
  'tomorrow',
  'yesterday',
  'oneWeekAgo',
  'oneWeekFromNow',
  'oneMonthAgo',
  'oneMonthFromNow',
  'pastWeek',
  'pastMonth',
  'pastYear',
  'nextWeek',
  'nextMonth',
  'nextYear',
] as const;
export type RelativeDate = (typeof RELATIVE_DATES)[number];

export const RELATIVE_DATE_LABELS: Record<RelativeDate, string> = {
  today: '今天',
  tomorrow: '明天',
  yesterday: '昨天',
  oneWeekAgo: '一週前',
  oneWeekFromNow: '一週後',
  oneMonthAgo: '一個月前',
  oneMonthFromNow: '一個月後',
  pastWeek: '過去一週',
  pastMonth: '過去一個月',
  pastYear: '過去一年',
  nextWeek: '未來一週',
  nextMonth: '未來一個月',
  nextYear: '未來一年',
};

/**
 * 日期篩選的值（03 §6.5）。相對日期**必須在產生 SQL 時才展開成絕對時間**，
 * 存相對值、查詢時展開，「今天到期」每天才會是對的。
 */
export type DateFilterValue =
  | { kind: 'exact'; start: string; end?: string | null }
  | { kind: 'relative'; relative: RelativeDate }
  | { kind: 'relativeN'; unit: 'day' | 'week' | 'month' | 'year'; value: number };

export interface FilterCondition {
  property: string;
  operator: FilterOperator;
  /** isEmpty / isNotEmpty 不需要 value */
  value?: unknown;
}

export interface FilterGroup {
  operator: 'and' | 'or';
  filters: Array<FilterCondition | FilterGroup>;
}

export function isFilterGroup(f: FilterCondition | FilterGroup): f is FilterGroup {
  return typeof (f as FilterGroup).operator === 'string' && Array.isArray((f as FilterGroup).filters);
}

export const EMPTY_FILTER: FilterGroup = { operator: 'and', filters: [] };

export function countFilters(f: FilterGroup | FilterCondition | null | undefined): number {
  if (!f) return 0;
  if (!isFilterGroup(f)) return 1;
  return f.filters.reduce<number>((sum, child) => sum + countFilters(child), 0);
}

export interface SortSpec {
  property: string;
  direction: 'ascending' | 'descending';
}

/** 泳道（Board 欄）的排序／收合／顯示設定（03 §6.5 的 group_by.groups） */
export interface GroupConfig {
  /** 分組值：select 的 optionId、checkbox 的 'true'/'false'、空值為 null */
  key: string | null;
  visible?: boolean;
  collapsed?: boolean;
}

export interface GroupBySpec {
  property: string;
  hideEmptyGroups?: boolean;
  groups?: GroupConfig[];
}

export interface ViewQuery {
  filter?: FilterGroup | null;
  sort?: SortSpec[];
  groupBy?: GroupBySpec | null;
  pageSize?: number;
  searchQuery?: string | null;
  /** 聚合列：propertyId → 函式 */
  aggregations?: Record<string, AggregationFunction>;
}

export interface ViewPropertyFormat {
  property: string;
  visible: boolean;
  width?: number;
}

export type CoverSource =
  | { type: 'none' }
  | { type: 'pageCover' }
  | { type: 'pageContent' }
  | { type: 'property'; property: string };

export interface ViewFormat {
  /** 欄位顯示順序與寬度。沒列到的欄位排在最後、預設顯示 */
  properties?: ViewPropertyFormat[];
  tableWrapCells?: boolean;
  tableRowNumbers?: boolean;
  /** 凍結左側幾欄（Notion 預設凍結標題欄 = 1） */
  tableFreezeColumns?: number;
  boardColumnWidth?: number;
  boardCover?: CoverSource;
  galleryCover?: CoverSource;
  gallerySize?: 'small' | 'medium' | 'large';
  galleryFitImage?: boolean;
  calendarDateProperty?: string | null;
  calendarShowWeekend?: boolean;
  listShowProperties?: boolean;

  /* ── 時程表（Timeline）──
     Notion 的時程表用「開始 / 結束」兩個日期欄位畫長條；只給開始時視為單日。
     結束欄位留空 = 用同一個日期欄位的 `end`（date range）。 */
  timelineStartProperty?: string | null;
  timelineEndProperty?: string | null;
  /** 橫軸刻度：一格代表一天 / 一週 / 一個月 */
  timelineScale?: TimelineScale;
  /** 左側可折疊的表格欄要不要展開 */
  timelineShowTable?: boolean;
  /** 左側表格欄寬（px） */
  timelineTableWidth?: number;
}

/** 時程表橫軸刻度（`07i-db-timeline-light.png` 的「月 ⌄」下拉） */
export const TIMELINE_SCALES = ['day', 'week', 'month'] as const;
export type TimelineScale = (typeof TIMELINE_SCALES)[number];

export const TIMELINE_SCALE_LABELS: Record<TimelineScale, string> = {
  day: '日',
  week: '週',
  month: '月',
};

export interface CollectionView {
  id: string;
  workspaceId: string;
  collectionId: string;
  type: ViewType;
  name: string;
  query: ViewQuery;
  format: ViewFormat;
  manualOrder: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** database 的一列 = pages 的一列（03 §4.5） */
export interface DatabaseRow {
  id: string;
  collectionId: string;
  title: RichText;
  icon: string | null;
  cover: string | null;
  /** 含計算欄位（formula / rollup / 系統欄位）的完整值 */
  properties: RowProperties;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface DatabaseSnapshot {
  collection: Collection;
  views: CollectionView[];
}

export interface RowGroup {
  /** 分組值；null = 未設定 */
  key: string | null;
  /** 顯示名稱（select 的 option value、checkbox 的「已勾選」…） */
  label: string;
  color?: SelectColor;
  count: number;
  rows: DatabaseRow[];
  hasMore: boolean;
}

export interface AggregationResult {
  property: string;
  function: AggregationFunction;
  value: number | string | null;
}

export interface QueryRowsResult {
  collectionId: string;
  viewId: string | null;
  rows: DatabaseRow[];
  /** groupBy 生效時才有（Board / 分組表格） */
  groups?: RowGroup[];
  aggregations?: AggregationResult[];
  /** keyset 分頁游標；null = 沒有下一頁 */
  cursor: string | null;
  hasMore: boolean;
  /** 符合條件的總筆數（分組時為全部列的總數） */
  total: number;
}

/* ── schema 編輯（PATCH /api/databases/:id/schema）───────── */

/**
 * `add` 的 `createDual`：新增 relation 欄位時，順便在**目標資料庫**建一個
 * 反向 relation 欄位，並讓兩邊互指（Notion 的「在〈目標〉顯示」開關）。
 * 後端在同一個交易內完成；目標 collection 由 `definition.collectionId` 決定。
 */
export interface CreateDualRelation {
  /** 反向欄位在目標資料庫裡的名稱 */
  name: string;
}

export type SchemaOp =
  | {
      op: 'add';
      propertyId?: string;
      definition: FieldDefinition;
      createDual?: CreateDualRelation;
    }
  | { op: 'rename'; propertyId: string; name: string }
  | {
      op: 'update';
      propertyId: string;
      definition: FieldDefinition;
      /** relation：把「在目標資料庫顯示」打開時，順便建反向欄位 */
      createDual?: CreateDualRelation;
    }
  | { op: 'retype'; propertyId: string; definition: FieldDefinition }
  | { op: 'delete'; propertyId: string };

export interface SchemaMigrationReport {
  propertyId: string;
  /** 掃過幾列 */
  scanned: number;
  /** 成功轉換幾列 */
  converted: number;
  /** 無法轉換而被清空幾列（UI 必須事前警告，02 §4.3.1） */
  cleared: number;
}

export interface PatchSchemaResult {
  collection: Collection;
  migrations: SchemaMigrationReport[];
}

/** 型別切換前的預告（02 §4.3.1「絕不可靜默轉換並丟失資料」） */
export interface CastPreview {
  propertyId: string;
  fromType: FieldType;
  toType: FieldType;
  affected: number;
  convertible: number;
  lossy: number;
  /** 前幾筆無法轉換的樣本，給對話框顯示 */
  samples: string[];
}
