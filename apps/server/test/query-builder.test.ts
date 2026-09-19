import { describe, expect, it } from 'vitest';
import type { CollectionSchema } from '@kennote/shared-types';
import { AppError } from '../src/lib/errors.js';
import { buildFilterSql, buildOrderSql } from '../src/modules/databases/query-builder.js';
import '../src/modules/databases/field-types/index.js';

const schema: CollectionSchema = {
  title: { name: '名稱', type: 'title' },
  Num1: { name: '預算', type: 'number' },
  Sel1: {
    name: '狀態',
    type: 'select',
    options: [{ id: 'opt_1', value: '進行中', color: 'blue' }],
  },
  Mul1: {
    name: '標籤',
    type: 'multiSelect',
    options: [{ id: 'tag_1', value: '後端', color: 'purple' }],
  },
  Chk1: { name: '完成', type: 'checkbox' },
  Dat1: { name: '截止日', type: 'date' },
};

describe('database query builder', () => {
  it('文字 contains 會參數化且跳脫萬用字元', () => {
    const q = buildFilterSql(schema, {
      operator: 'and',
      filters: [{ property: 'title', operator: 'contains', value: '100%_x' }],
    })!;
    expect(q.text).toContain('ILIKE');
    expect(q.values).toEqual([String.raw`%100\%\_x%`]);
    expect(q.text).not.toContain('100');
  });

  it('數值比較會轉成 numeric 並參數化', () => {
    const q = buildFilterSql(schema, {
      operator: 'and',
      filters: [{ property: 'Num1', operator: 'greaterThan', value: '500' }],
    })!;
    expect(q.text).toContain('::numeric');
    expect(q.values).toContain(500);
  });

  it('欄位 id 是參數而不是拼進 SQL 文字', () => {
    const q = buildFilterSql(schema, {
      operator: 'and',
      filters: [{ property: 'Sel1', operator: 'is', value: 'opt_1' }],
    })!;
    expect(q.text).not.toContain('Sel1');
    expect(q.values).toContain('Sel1');
    expect(q.values).toContain('opt_1');
  });

  it('multiSelect contains 走 jsonb 容器查詢', () => {
    const q = buildFilterSql(schema, {
      operator: 'and',
      filters: [{ property: 'Mul1', operator: 'contains', value: 'tag_1' }],
    })!;
    expect(q.text).toContain('@>');
    expect(q.values).toEqual(['Mul1', 'optionIds', 'tag_1']);
  });

  it('and / or 巢狀組合', () => {
    const q = buildFilterSql(schema, {
      operator: 'and',
      filters: [
        { property: 'Chk1', operator: 'is', value: false },
        {
          operator: 'or',
          filters: [
            { property: 'Num1', operator: 'lessThan', value: 10 },
            { property: 'title', operator: 'isEmpty' },
          ],
        },
      ],
    })!;
    expect(q.text).toContain(' AND ');
    expect(q.text).toContain(' OR ');
  });

  it('不存在的欄位 → INVALID_FILTER', () => {
    try {
      buildFilterSql(schema, {
        operator: 'and',
        filters: [{ property: 'NotThere', operator: 'is', value: 'x' }],
      });
      throw new Error('應該要丟錯');
    } catch (err) {
      expect((err as AppError).code).toBe('INVALID_FILTER');
    }
  });

  it('欄位不支援的運算子 → INVALID_FILTER', () => {
    expect(() =>
      buildFilterSql(schema, {
        operator: 'and',
        filters: [{ property: 'Chk1', operator: 'contains', value: 'x' }],
      }),
    ).toThrow(AppError);
  });

  it('巢狀過深 → 拒絕', () => {
    let filter: any = { property: 'title', operator: 'isEmpty' };
    for (let i = 0; i < 8; i++) filter = { operator: 'and', filters: [filter] };
    expect(() => buildFilterSql(schema, filter)).toThrow(AppError);
  });

  it('空 filter 回 null', () => {
    expect(buildFilterSql(schema, null)).toBeNull();
    expect(buildFilterSql(schema, { operator: 'and', filters: [] })).toBeNull();
  });

  it('排序預設用 sort_key，指定排序會加上欄位投影', () => {
    expect(buildOrderSql(schema, []).text).toBe('p.sort_key ASC, p.created_at ASC');
    const q = buildOrderSql(schema, [{ property: 'Num1', direction: 'descending' }]);
    expect(q.text).toContain('DESC NULLS LAST');
    expect(q.values).toEqual(['Num1']);
  });

  it('排序欄位也走白名單', () => {
    expect(() => buildOrderSql(schema, [{ property: 'evil; DROP', direction: 'ascending' }])).toThrow(
      AppError,
    );
  });
});
