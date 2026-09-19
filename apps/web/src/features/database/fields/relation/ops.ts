import type { FieldTypeDefinition } from '../types';
import { CONTAINER_OPS, COUNT_AGGS, idsOf } from '../_shared/ops';

export const ops = {
  label: '關聯',
  icon: 'relation',
  group: 'advanced',
  sortable: false,
  filterable: true,
  groupable: false,
  computed: false,
  defaultConfig: (name: string) => ({
    name,
    type: 'relation',
    collectionId: null,
    dualProperty: null,
    allowMultiple: true,
  }),
  defaultValue: null,
  filterOperators: CONTAINER_OPS,
  aggregations: COUNT_AGGS,
  compare: (a, b) => idsOf(a).length - idsOf(b).length,
  groupKeys: () => [null],
  groupLabel: (key) => ({ label: key ?? '無關聯' }),
  toPlainText: (value) => idsOf(value).join(', '),
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
