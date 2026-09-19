import type { FieldTypeDefinition } from '../types';
import { COUNT_AGGS, SELECT_OPS, compareNullable, optionList, optionOf } from '../_shared/ops';

export const ops = {
  label: '單選',
  icon: 'select',
  group: 'basic',
  sortable: true,
  filterable: true,
  groupable: true,
  computed: false,
  defaultConfig: (name: string) => ({ name, type: 'select', options: [] }),
  defaultValue: null,
  filterOperators: SELECT_OPS,
  aggregations: COUNT_AGGS,
  // 排序依選項在 schema 裡的順序 —— 使用者拖曳選項就是在定義順序
  compare: (a, b, def) => {
    const order = optionList(def).map((o) => o.id);
    const indexOf = (v: typeof a) => {
      const id = v && v.type === 'select' ? v.optionId : null;
      const i = id ? order.indexOf(id) : -1;
      return i >= 0 ? i : null;
    };
    return compareNullable(indexOf(a), indexOf(b), (x, y) => x - y);
  },
  groupKeys: (value) => [value && value.type === 'select' ? value.optionId : null],
  groupLabel: (key, def) => {
    if (key === null) return { label: '無' };
    const option = optionOf(def, key);
    return { label: option?.value ?? key, color: option?.color };
  },
  toPlainText: (value, def) =>
    value && value.type === 'select' ? (optionOf(def, value.optionId)?.value ?? '') : '',
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
