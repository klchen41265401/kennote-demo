import type { FieldTypeDefinition } from '../types';
import { DATE_AGGS, DATE_OPS, compareDateValues, dateStartOf, formatDateValue } from '../_shared/ops';

export const ops = {
  label: '建立時間',
  icon: 'createdTime',
  group: 'system',
  sortable: true,
  filterable: true,
  groupable: true,
  computed: true,
  defaultConfig: (name: string) => ({ name, type: 'createdTime', dateFormat: 'YYYY/MM/DD' }),
  defaultValue: null,
  filterOperators: DATE_OPS,
  aggregations: DATE_AGGS,
  compare: compareDateValues,
  groupKeys: (value) => {
    const start = dateStartOf(value);
    return [start ? start.slice(0, 10) : null];
  },
  groupLabel: (key) => ({ label: key ?? '無' }),
  toPlainText: (value, def) => formatDateValue(dateStartOf(value), def),
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
