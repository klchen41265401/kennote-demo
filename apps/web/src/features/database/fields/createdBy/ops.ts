import type { FieldTypeDefinition } from '../types';
import { CONTAINER_OPS, COUNT_AGGS, compareNullable, idsOf } from '../_shared/ops';

export const ops = {
  label: '建立者',
  icon: 'createdBy',
  group: 'system',
  sortable: true,
  filterable: true,
  groupable: true,
  computed: true,
  defaultConfig: (name: string) => ({ name, type: 'createdBy' }),
  defaultValue: null,
  filterOperators: CONTAINER_OPS,
  aggregations: COUNT_AGGS,
  compare: (a, b) =>
    compareNullable(idsOf(a)[0] ?? null, idsOf(b)[0] ?? null, (x, y) => (x < y ? -1 : x > y ? 1 : 0)),
  groupKeys: (value) => {
    const ids = idsOf(value);
    return ids.length > 0 ? [ids[0] as string] : [null];
  },
  groupLabel: (key) => ({ label: key ?? '無' }),
  toPlainText: (value) => idsOf(value).join(', '),
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
