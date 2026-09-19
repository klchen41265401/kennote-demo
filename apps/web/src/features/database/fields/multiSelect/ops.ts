import type { FieldTypeDefinition } from '../types';
import { CONTAINER_OPS, COUNT_AGGS, compareNullable, idsOf, optionList, optionOf } from '../_shared/ops';

export const ops = {
  label: '多選',
  icon: 'multiSelect',
  group: 'basic',
  sortable: true,
  filterable: true,
  groupable: true,
  computed: false,
  defaultConfig: (name: string) => ({ name, type: 'multiSelect', options: [] }),
  defaultValue: null,
  filterOperators: [...CONTAINER_OPS, 'isAnyOf' as const],
  aggregations: COUNT_AGGS,
  compare: (a, b, def) => {
    const order = optionList(def).map((o) => o.id);
    const indexOf = (v: typeof a) => {
      const first = idsOf(v)[0];
      const i = first ? order.indexOf(first) : -1;
      return i >= 0 ? i : null;
    };
    return compareNullable(indexOf(a), indexOf(b), (x, y) => x - y);
  },
  // 一張卡可以同時出現在多個泳道（Notion 的行為）
  groupKeys: (value) => {
    const ids = idsOf(value);
    return ids.length > 0 ? [...ids] : [null];
  },
  groupLabel: (key, def) => {
    if (key === null) return { label: '無' };
    const option = optionOf(def, key);
    return { label: option?.value ?? key, color: option?.color };
  },
  toPlainText: (value, def) =>
    idsOf(value)
      .map((id) => optionOf(def, id)?.value ?? '')
      .filter(Boolean)
      .join(', '),
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
