import type { FieldTypeDefinition } from '../types';
import { DATE_AGGS, DATE_OPS, compareDateValues, dateStartOf, formatDateValue } from '../_shared/ops';

export const ops = {
  label: '日期',
  icon: 'date',
  group: 'basic',
  sortable: true,
  filterable: true,
  groupable: true,
  computed: false,
  defaultConfig: (name: string) => ({ name, type: 'date', dateFormat: 'YYYY/MM/DD' }),
  defaultValue: null,
  filterOperators: DATE_OPS,
  aggregations: DATE_AGGS,
  compare: compareDateValues,
  // 分組依「日」，否則每個時間戳都自成一組
  groupKeys: (value) => {
    const start = dateStartOf(value);
    return [start ? start.slice(0, 10) : null];
  },
  groupLabel: (key) => ({ label: key ?? '無日期' }),
  toPlainText: (value, def) => {
    if (!value || value.type !== 'date') return '';
    const start = formatDateValue(value.start, def);
    return value.end ? start + ' → ' + formatDateValue(value.end, def) : start;
  },
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
