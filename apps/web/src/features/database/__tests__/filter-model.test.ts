/**
 * 篩選條件樹的純邏輯測試。
 * 這棵樹是後端 query-builder 的輸入，結構錯了就會查出錯的資料。
 */
import { describe, expect, it } from 'vitest';
import type { CollectionSchema, FilterGroup } from '@kennote/shared-types';
import { countFilters } from '@kennote/shared-types';
import '../fields/index';
import {
  addCondition,
  addGroup,
  changeProperty,
  defaultCondition,
  filterDepth,
  filterableProperties,
  needsValue,
  normalizeFilter,
  operatorsFor,
  replaceChild,
  setOperator,
} from '../filter-model';

const schema: CollectionSchema = {
  title: { name: '名稱', type: 'title' },
  Num1: { name: '預算', type: 'number' },
  Chk1: { name: '完成', type: 'checkbox' },
  Dat1: { name: '截止日', type: 'date' },
};

describe('運算子來自 registry', () => {
  it('文字欄位有 contains，數值欄位沒有', () => {
    expect(operatorsFor(schema, 'title')).toContain('contains');
    expect(operatorsFor(schema, 'Num1')).not.toContain('contains');
    expect(operatorsFor(schema, 'Num1')).toContain('greaterThan');
  });

  it('checkbox 只有 is', () => {
    expect(operatorsFor(schema, 'Chk1')).toEqual(['is']);
  });

  it('不存在的欄位回空陣列，不丟例外', () => {
    expect(operatorsFor(schema, 'NotThere')).toEqual([]);
  });

  it('isEmpty / isNotEmpty 不需要值編輯器', () => {
    expect(needsValue('isEmpty')).toBe(false);
    expect(needsValue('isNotEmpty')).toBe(false);
    expect(needsValue('contains')).toBe(true);
  });

  it('可篩選欄位清單來自 registry 的 filterable', () => {
    expect(filterableProperties(schema)).toEqual(['title', 'Num1', 'Chk1', 'Dat1']);
  });
});

describe('條件樹的增刪改', () => {
  const empty: FilterGroup = { operator: 'and', filters: [] };

  it('新條件用第一個可篩選欄位與該型別的第一個運算子', () => {
    const condition = defaultCondition(schema);
    expect(condition).toEqual({ property: 'title', operator: 'is', value: '' });
  });

  it('沒有可篩選欄位時回 null，而不是產生壞條件', () => {
    expect(defaultCondition({})).toBeNull();
  });

  it('新增條件 / 新增群組', () => {
    const condition = defaultCondition(schema)!;
    const withCondition = addCondition(empty, condition);
    expect(withCondition.filters).toHaveLength(1);

    const withGroup = addGroup(withCondition, condition);
    expect(withGroup.filters).toHaveLength(2);
    expect(countFilters(withGroup)).toBe(2);
    expect(filterDepth(withGroup)).toBe(2);
  });

  it('replaceChild 傳 null 等於刪除', () => {
    const condition = defaultCondition(schema)!;
    const group = addCondition(addCondition(empty, condition), condition);
    expect(replaceChild(group, 0, null).filters).toHaveLength(1);
  });

  it('不會就地改動原本的物件（避免 React 看不到變化）', () => {
    const condition = defaultCondition(schema)!;
    const next = addCondition(empty, condition);
    expect(empty.filters).toHaveLength(0);
    expect(next).not.toBe(empty);
  });

  it('切換 and / or', () => {
    expect(setOperator(empty, 'or').operator).toBe('or');
  });

  it('換欄位時運算子會跟著換成新型別支援的', () => {
    const condition = { property: 'title', operator: 'contains' as const, value: 'abc' };
    const next = changeProperty(schema, condition, 'Chk1');
    expect(next.operator).toBe('is');
    expect(next.property).toBe('Chk1');
  });

  it('換欄位時若新型別也支援原運算子就保留', () => {
    const condition = { property: 'Num1', operator: 'isEmpty' as const };
    const next = changeProperty(schema, condition, 'Dat1');
    expect(next.operator).toBe('isEmpty');
    expect(next.value).toBeUndefined();
  });
});

describe('normalizeFilter', () => {
  it('空群組壓成 null（後端才不會收到沒有意義的條件）', () => {
    expect(normalizeFilter({ operator: 'and', filters: [] })).toBeNull();
    expect(
      normalizeFilter({
        operator: 'and',
        filters: [{ operator: 'or', filters: [] }],
      }),
    ).toBeNull();
  });

  it('保留有內容的巢狀群組', () => {
    const tree: FilterGroup = {
      operator: 'and',
      filters: [
        { property: 'Num1', operator: 'greaterThan', value: 10 },
        {
          operator: 'or',
          filters: [
            { property: 'Chk1', operator: 'is', value: false },
            { operator: 'and', filters: [] },
          ],
        },
      ],
    };
    const normalized = normalizeFilter(tree)!;
    expect(countFilters(normalized)).toBe(2);
    expect(filterDepth(normalized)).toBe(2);
  });

  it('「狀態 = 進行中 AND (預算 > 10 OR 截止日為空)」的樹形狀正確', () => {
    const tree: FilterGroup = {
      operator: 'and',
      filters: [
        { property: 'title', operator: 'is', value: '進行中' },
        {
          operator: 'or',
          filters: [
            { property: 'Num1', operator: 'greaterThan', value: 10 },
            { property: 'Dat1', operator: 'isEmpty' },
          ],
        },
      ],
    };
    const normalized = normalizeFilter(tree)!;
    expect(normalized.operator).toBe('and');
    expect(countFilters(normalized)).toBe(3);
  });
});
