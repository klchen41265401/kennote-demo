import type { FieldTypeDefinition } from '../types';
import { NUMBER_AGGS, NUMBER_OPS, compareNumberValues, formatNumber, numberOf } from '../_shared/ops';

export const ops = {
  label: '數字',
  icon: 'number',
  group: 'basic',
  sortable: true,
  filterable: true,
  groupable: true,
  computed: false,
  editorSurface: 'inline',
  defaultConfig: (name: string) => ({ name, type: 'number', numberFormat: 'number' }),
  defaultValue: null,
  filterOperators: NUMBER_OPS,
  aggregations: NUMBER_AGGS,
  compare: compareNumberValues,
  groupKeys: (value) => {
    const n = numberOf(value);
    return [n === null ? null : String(n)];
  },
  groupLabel: (key) => ({ label: key ?? '空白' }),
  toPlainText: (value, def) => formatNumber(numberOf(value), def),
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
