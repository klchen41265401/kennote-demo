import type { RichText } from './richtext.js';

/**
 * Database（collection）型別。對應 03 §6.3–6.6，但欄位一律 camelCase
 * （與 BlockType union 的命名一致；理由見 docs/adr/0002）。
 */

/** MVP 的 8 種欄位型別（04 §10.2 明確砍到 8 種 + 2 種視圖） */
export const FIELD_TYPES = [
  'title',
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
  'person',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

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

interface FieldDefinitionBase {
  name: string;
  description?: string;
  readonly?: boolean;
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
  | (FieldDefinitionBase & { type: 'person'; allowMultiple?: boolean });

/** key = propertyId（'title' 或 4~8 碼短碼），value = 欄位定義 */
export type CollectionSchema = Record<string, FieldDefinition>;

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
  | { type: 'person'; userIds: string[] };

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

/** MVP 先實作 table / board / list（04 §8 M4：三視圖） */
export const VIEW_TYPES = ['table', 'board', 'list', 'gallery', 'calendar'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

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
  | 'isBefore'
  | 'isAfter'
  | 'isOnOrBefore'
  | 'isOnOrAfter';

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
  return typeof (f as FilterGroup).operator === 'string' && 'filters' in f;
}

export interface SortSpec {
  property: string;
  direction: 'ascending' | 'descending';
}

export interface ViewQuery {
  filter?: FilterGroup | null;
  sort?: SortSpec[];
  groupBy?: { property: string; hideEmptyGroups?: boolean } | null;
  pageSize?: number;
  searchQuery?: string | null;
}

export interface ViewPropertyFormat {
  property: string;
  visible: boolean;
  width?: number;
}

export interface ViewFormat {
  properties?: ViewPropertyFormat[];
  tableWrapCells?: boolean;
  tableRowNumbers?: boolean;
  boardColumnWidth?: number;
  listShowProperties?: boolean;
}

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

export interface QueryRowsResult {
  collectionId: string;
  viewId: string | null;
  rows: DatabaseRow[];
  total: number;
  hasMore: boolean;
}
