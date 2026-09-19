import type { FieldTypeDefinition } from '../types';
import { BOOLEAN_AGGS } from '../_shared/ops';

const checked = (v: { type: string; checkbox?: boolean } | undefined) =>
  Boolean(v && v.type === 'checkbox' && v.checkbox);

export const ops = {
  label: '核取方塊',
  icon: 'checkbox',
  group: 'basic',
  sortable: true,
  filterable: true,
  groupable: true,
  computed: false,
  // 勾選框不進編輯態，點一下就切換（02 §3.5 的對照表）
  editInline: true,
  defaultConfig: (name: string) => ({ name, type: 'checkbox' }),
  defaultValue: { type: 'checkbox', checkbox: false },
  filterOperators: ['is' as const],
  aggregations: BOOLEAN_AGGS,
  compare: (a, b) => Number(checked(a)) - Number(checked(b)),
  groupKeys: (value) => [checked(value) ? 'true' : 'false'],
  groupLabel: (key) => ({ label: key === 'true' ? '已勾選' : '未勾選' }),
  toPlainText: (value) => (checked(value) ? '是' : '否'),
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
