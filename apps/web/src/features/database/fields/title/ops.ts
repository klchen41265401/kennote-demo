import type { FieldTypeDefinition } from '../types';
import { COUNT_AGGS, TEXT_OPS, compareTextValues, plainTextOf } from '../_shared/ops';

export const ops = {
  label: '標題',
  icon: 'title',
  group: 'basic',
  sortable: true,
  filterable: true,
  groupable: false,
  computed: false,
  editorSurface: 'inline',
  defaultConfig: (name: string) => ({ name, type: 'title' }),
  defaultValue: null,
  filterOperators: TEXT_OPS,
  aggregations: COUNT_AGGS,
  compare: compareTextValues,
  groupKeys: (value) => [plainTextOf(value) || null],
  groupLabel: (key) => ({ label: key ?? '未命名' }),
  toPlainText: (value) => plainTextOf(value),
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
