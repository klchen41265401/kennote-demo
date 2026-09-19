import type { FieldTypeDefinition } from '../types';
import { NUMBER_AGGS, NUMBER_OPS, TEXT_OPS, compareNullable, computedValueOf } from '../_shared/ops';

/** 結果型別要算出來才知道，所以運算子給文字 + 數值的聯集 */
const COMPUTED_OPS = [...new Set([...TEXT_OPS, ...NUMBER_OPS])];

export const ops = {
  label: '匯總',
  icon: 'rollup',
  group: 'advanced',
  sortable: true,
  filterable: true,
  groupable: false,
  computed: true,
  defaultConfig: (name: string) =>
    ({ name, type: 'rollup', relationProperty: null, targetProperty: null, function: 'count' }),
  defaultValue: null,
  filterOperators: COMPUTED_OPS,
  aggregations: NUMBER_AGGS,
  compare: (a, b) =>
    compareNullable(computedValueOf(a), computedValueOf(b), (x, y) =>
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x) < String(y)
          ? -1
          : String(x) > String(y)
            ? 1
            : 0,
    ),
  groupKeys: (value) => {
    const v = computedValueOf(value);
    return [v === null ? null : String(v)];
  },
  groupLabel: (key) => ({ label: key ?? '無' }),
  toPlainText: (value) => {
    const v = computedValueOf(value);
    return v === null ? '' : String(v);
  },
} satisfies Omit<FieldTypeDefinition, 'type' | 'Cell' | 'Editor' | 'Config' | 'FilterInput'>;
