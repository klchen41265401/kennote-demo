/**
 * query-builder 的 SQL 層測試。
 *
 * 不需要資料庫：sql`` 產生的是 { text, values }，直接對字串與參數陣列斷言，
 * 就能驗證「欄位名走白名單、值一律參數化」這條最重要的安全規則
 * （04 §8 M4 驗收標準：篩選器的 SQL 通過 injection 測試）。
 */
import { describe, expect, it } from 'vitest';
import type { CollectionSchema } from '@kennote/shared-types';
import { AppError } from '../src/lib/errors.js';
import {
  buildAggregationSql,
  buildCursorSql,
  buildFilterSql,
  buildGroupKeySql,
  buildOrderSql,
  buildSearchSql,
  compileViewQuery,
  decodeCursor,
  encodeCursor,
  sortKeySelectSql,
} from '../src/modules/databases/query-builder.js';
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
  Per1: { name: '負責人', type: 'person' },
  Rat1: { name: '星等', type: 'rating', max: 5 },
  For1: {
    name: '剩餘天數',
    type: 'formula',
    expression: '1 + 1',
    ast: { op: 'binary', operator: '+', left: { op: 'lit', value: 1 }, right: { op: 'lit', value: 1 } },
    resultType: 'number',
    dependsOn: [],
  },
};

const ctx = { now: new Date('2026-09-19T00:00:00Z'), timeZone: 'Asia/Taipei' };

describe('filter → SQL', () => {
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

  it('multiSelect contains 走 jsonb 容器查詢（吃得到 GIN）', () => {
    const q = buildFilterSql(schema, {
      operator: 'and',
      filters: [{ property: 'Mul1', operator: 'contains', value: 'tag_1' }],
    })!;
    expect(q.text).toContain('@>');
    expect(q.values).toEqual(['Mul1', 'optionIds', 'tag_1']);
  });

  it('person contains 走 userIds 的容器查詢', () => {
    const q = buildFilterSql(schema, {
      operator: 'and',
      filters: [{ property: 'Per1', operator: 'contains', value: 'user-1' }],
    })!;
    expect(q.values).toEqual(['Per1', 'userIds', 'user-1']);
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

  it('日期相對值在產生 SQL 時展開成絕對時間', () => {
    const q = buildFilterSql(
      schema,
      {
        operator: 'and',
        filters: [
          { property: 'Dat1', operator: 'isBefore', value: { kind: 'relative', relative: 'today' } },
        ],
      },
      ctx,
    )!;
    // 台北時間 2026-09-19 08:00 → 當地日期仍是 09-19
    expect(q.values).toEqual(['Dat1', 'start', '2026-09-19']);
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
    let filter: unknown = { property: 'title', operator: 'isEmpty' };
    for (let i = 0; i < 8; i += 1) filter = { operator: 'and', filters: [filter] };
    expect(() => buildFilterSql(schema, filter as never)).toThrow(AppError);
  });

  it('空 filter 回 null', () => {
    expect(buildFilterSql(schema, null)).toBeNull();
    expect(buildFilterSql(schema, { operator: 'and', filters: [] })).toBeNull();
  });
});

describe('SQL injection', () => {
  const payloads = [
    "'; DROP TABLE pages; --",
    "1 OR 1=1",
    "x') OR ('1'='1",
    '\\',
    '%',
    '${jndi:ldap://x}',
  ];

  it('任何惡意字串都只會變成參數，不會進 SQL 文字', () => {
    for (const payload of payloads) {
      const q = buildFilterSql(schema, {
        operator: 'and',
        filters: [{ property: 'title', operator: 'is', value: payload }],
      })!;
      expect(q.text).not.toContain('DROP');
      expect(q.text).not.toContain(payload);
      expect(q.text).toMatch(/\$\d+/);
      expect(q.values).toContain(payload);
    }
  });

  it('惡意欄位名一律被白名單擋掉', () => {
    for (const property of ["title'; DROP TABLE pages; --", 'p.title_plain', '*']) {
      expect(() =>
        buildFilterSql(schema, { operator: 'and', filters: [{ property, operator: 'isEmpty' }] }),
      ).toThrow(AppError);
    }
  });

  it('排序欄位也走白名單', () => {
    expect(() => buildOrderSql(schema, [{ property: 'evil; DROP', direction: 'ascending' }])).toThrow(
      AppError,
    );
  });

  it('搜尋字串會跳脫 LIKE 萬用字元', () => {
    const q = buildSearchSql('50%_off')!;
    expect(q.values).toEqual([String.raw`%50\%\_off%`]);
  });
});

describe('sort / cursor', () => {
  it('預設用 sort_key，並且一定有 id 當 tie-break', () => {
    expect(buildOrderSql(schema, []).order.text).toBe('p.sort_key ASC, p.id ASC');
  });

  it('指定排序會加上欄位投影與 NULLS LAST', () => {
    const q = buildOrderSql(schema, [{ property: 'Num1', direction: 'descending' }]);
    expect(q.order.text).toContain('DESC NULLS LAST');
    expect(q.order.text).toContain('p.id ASC');
    expect(q.order.values).toEqual(['Num1']);
  });

  it('排序鍵會被 SELECT 出來給 cursor 用', () => {
    const compiled = buildOrderSql(schema, [{ property: 'Dat1', direction: 'ascending' }]);
    expect(sortKeySelectSql(compiled).text).toContain('AS sk0');
  });

  it('cursor 是可往返的 base64url', () => {
    const payload = { keys: ['2026-09-19', 3], id: '018f-aaa' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('壞掉的 cursor → BAD_REQUEST 而不是 500', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(AppError);
  });

  it('cursor 條件展開成字典序的 OR 鏈，且值全部參數化', () => {
    const compiled = buildOrderSql(schema, [{ property: 'Num1', direction: 'descending' }]);
    const q = buildCursorSql(compiled, { keys: [42], id: '018f-bbb' });
    expect(q.text).toContain(' OR ');
    expect(q.text).toContain('IS NOT DISTINCT FROM');
    expect(q.values).toContain(42);
    expect(q.values).toContain('018f-bbb');
  });
});

describe('group / aggregation', () => {
  it('select 的分組鍵是 optionId', () => {
    const q = buildGroupKeySql(schema, 'Sel1');
    expect(q.values).toEqual(['Sel1', 'optionId']);
  });

  it('checkbox 的分組鍵是 true/false', () => {
    expect(buildGroupKeySql(schema, 'Chk1').text).toContain('CASE WHEN');
  });

  it('不能分組的欄位會被擋下來', () => {
    expect(() => buildGroupKeySql(schema, 'title')).toThrow(AppError);
  });

  it('數值欄位可以 sum / average', () => {
    expect(buildAggregationSql(schema, 'Num1', 'sum')!.text).toContain('sum(');
    expect(buildAggregationSql(schema, 'Num1', 'average')!.text).toContain('avg(');
  });

  it('文字欄位不能 sum', () => {
    expect(() => buildAggregationSql(schema, 'title', 'sum')).toThrow(AppError);
  });

  it('none 不產生 SQL', () => {
    expect(buildAggregationSql(schema, 'Num1', 'none')).toBeNull();
  });
});

describe('計算欄位（formula）', () => {
  it('formula 參與 filter 時改走記憶體路徑，SQL 端不產生條件', () => {
    const compiled = compileViewQuery(
      schema,
      { filter: { operator: 'and', filters: [{ property: 'For1', operator: 'greaterThan', value: 1 }] } },
      ctx,
    );
    expect(compiled.memoryFilter).toBe(true);
    expect(compiled.where).toBeNull();
  });

  it('formula 參與 sort 時改走記憶體排序', () => {
    const compiled = compileViewQuery(
      schema,
      { sort: [{ property: 'For1', direction: 'ascending' }] },
      ctx,
    );
    expect(compiled.memorySort).toBe(true);
    expect(compiled.sort.order.text).toBe('p.sort_key ASC, p.id ASC');
  });

  it('一般欄位不會誤判成記憶體路徑', () => {
    const compiled = compileViewQuery(
      schema,
      {
        filter: { operator: 'and', filters: [{ property: 'Rat1', operator: 'greaterThan', value: 3 }] },
        sort: [{ property: 'Rat1', direction: 'descending' }],
      },
      ctx,
    );
    expect(compiled.memoryFilter).toBe(false);
    expect(compiled.memorySort).toBe(false);
    expect(compiled.where?.values).toContain(3);
  });
});
