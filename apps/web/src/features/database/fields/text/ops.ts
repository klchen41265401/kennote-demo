import type { FieldTypeDefinition } from '../types';
import { COUNT_AGGS, TEXT_OPS, compareTextValues, plainTextOf } from '../_shared/ops';

export const ops = {
  label: '文字',
  icon: 'text',
  group: 'basic',
  sortable: true,
  filterable: true,
  groupable: true,
  computed: false,
  editorSurface: 'inline',
  defaultConfig: (name: string) => ({ name, type: 'text' }),
  defaultValue: null,
  filterOperators: TEXT_OPS,
  aggregations: COUNT_AGGS,
  compare: compareTextValues,
  groupKeys: (value) => [plainTextOf(value) || null],
  groupLabel: (key) => ({ label: key ?? '空白' }),
  toPlainText: (value) => plainTextOf(value),
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
