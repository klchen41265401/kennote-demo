import type { FieldTypeDefinition } from '../types';
import { COUNT_AGGS, EMPTY_ONLY_OPS } from '../_shared/ops';

const files = (v: { type: string; files?: Array<{ name: string }> } | undefined) =>
  v && v.type === 'files' ? (v.files ?? []) : [];

export const ops = {
  label: '檔案與媒體',
  icon: 'files',
  group: 'basic',
  sortable: false,
  filterable: true,
  groupable: false,
  computed: false,
  defaultConfig: (name: string) => ({ name, type: 'files', maxFiles: 10 }),
  defaultValue: null,
  filterOperators: EMPTY_ONLY_OPS,
  aggregations: COUNT_AGGS,
  compare: (a, b) => files(a).length - files(b).length,
  groupKeys: () => [null],
  groupLabel: (key) => ({ label: key ?? '無附件' }),
  toPlainText: (value) => files(value).map((f) => f.name).join(', '),
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
