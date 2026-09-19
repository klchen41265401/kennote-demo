/**
 * 篩選條件樹的純邏輯（沒有 React，方便測試）。
 *
 * FilterBuilder 只負責畫 UI，樹的增刪改一律呼叫這裡的函式 ——
 * 條件樹的結構是後端 query-builder 的輸入，弄錯就會查出錯的資料，
 * 所以這一段必須是可單獨測試的純函式。
 */
import type {
  CollectionSchema,
  FilterCondition,
  FilterGroup,
  FilterOperator,
} from '@kennote/shared-types';
import { VALUELESS_OPERATORS, isFilterGroup } from '@kennote/shared-types';
import { getFieldType } from './fields/types';

export const MAX_FILTER_DEPTH = 2;

export function operatorsFor(schema: CollectionSchema, property: string): FilterOperator[] {
  const def = schema[property];
  return def ? getFieldType(def.type).filterOperators : [];
}

export function needsValue(operator: FilterOperator): boolean {
  return !VALUELESS_OPERATORS.includes(operator);
}

export function filterableProperties(schema: CollectionSchema): string[] {
  /* 標題欄排第一（跟 views/types.ts 的 visibleProperties()、07k/07l 參考圖一致） */
  return Object.entries(schema)
    .filter(([, def]) => def && getFieldType(def.type).filterable)
    .sort(([a], [b]) => (a === 'title' ? -1 : b === 'title' ? 1 : 0))
    .map(([id]) => id);
}

/** 新條件的預設值：第一個可篩選欄位 + 該型別的第一個運算子 */
export function defaultCondition(schema: CollectionSchema): FilterCondition | null {
  const property = filterableProperties(schema)[0];
  if (!property) return null;
  const operator = operatorsFor(schema, property)[0];
  if (!operator) return null;
  return { property, operator, value: '' };
}

/** 換欄位時運算子要跟著換成新型別支援的（不然會送出後端擋掉的組合） */
export function changeProperty(
  schema: CollectionSchema,
  condition: FilterCondition,
  property: string,
): FilterCondition {
  const operators = operatorsFor(schema, property);
  const operator = operators.includes(condition.operator)
    ? condition.operator
    : (operators[0] ?? 'isNotEmpty');
  return { property, operator, value: needsValue(operator) ? '' : undefined };
}

export function addCondition(group: FilterGroup, condition: FilterCondition): FilterGroup {
  return { ...group, filters: [...group.filters, condition] };
}

export function addGroup(group: FilterGroup, condition: FilterCondition): FilterGroup {
  return { ...group, filters: [...group.filters, { operator: 'or', filters: [condition] }] };
}

export function replaceChild(
  group: FilterGroup,
  index: number,
  next: FilterCondition | FilterGroup | null,
): FilterGroup {
  const filters = group.filters.slice();
  if (next === null) filters.splice(index, 1);
  else filters[index] = next;
  return { ...group, filters };
}

export function setOperator(group: FilterGroup, operator: 'and' | 'or'): FilterGroup {
  return { ...group, operator };
}

/** 空群組沒有意義（後端會忽略），送出前一律壓成 null */
export function normalizeFilter(group: FilterGroup | null | undefined): FilterGroup | null {
  if (!group) return null;
  const filters = group.filters
    .map((child) => (isFilterGroup(child) ? normalizeFilter(child) : child))
    .filter((child): child is FilterCondition | FilterGroup => child !== null);
  return filters.length === 0 ? null : { ...group, filters };
}

export function filterDepth(node: FilterCondition | FilterGroup | null | undefined): number {
  if (!node) return 0;
  if (!isFilterGroup(node)) return 0;
  return 1 + Math.max(0, ...node.filters.map(filterDepth));
}
