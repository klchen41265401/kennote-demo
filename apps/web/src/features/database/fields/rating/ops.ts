import type { FieldTypeDefinition } from '../types';
import { NUMBER_AGGS, NUMBER_OPS, compareNumberValues, numberOf } from '../_shared/ops';

export function ratingMax(def: { max?: number }): number {
  return Math.min(10, Math.max(1, Math.round(Number(def.max) || 5)));
}

export const ops = {
  label: '星等',
  icon: 'rating',
  group: 'basic',
  sortable: true,
  filterable: true,
  groupable: true,
  computed: false,
  editInline: true,
  defaultConfig: (name: string) => ({ name, type: 'rating', max: 5, icon: 'star' }),
  defaultValue: null,
  filterOperators: NUMBER_OPS,
  aggregations: NUMBER_AGGS,
  compare: compareNumberValues,
  groupKeys: (value) => {
    const n = numberOf(value);
    return [n === null || n === 0 ? null : String(n)];
  },
  groupLabel: (key, def) => ({
    label: key === null ? '未評分' : key + ' / ' + String(ratingMax(def as { max?: number })),
  }),
  toPlainText: (value, def) => {
    const n = numberOf(value);
    return n === null || n === 0 ? '' : n + '/' + String(ratingMax(def as { max?: number }));
  },
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
