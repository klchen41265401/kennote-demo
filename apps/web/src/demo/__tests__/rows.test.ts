/**
 * rows 查詢引擎（filter / sort / group / aggregation）。
 * 對照 `apps/server/src/modules/databases/query-builder.ts` 的語意。
 */
import { describe, expect, it } from 'vitest';
import type { CollectionSchema, DatabaseRow, RowProperties } from '@kennote/shared-types';
import { aggregate, buildGroups, matchesFilter, runQuery, sortRows } from '../rows';

const schema: CollectionSchema = {
  title: { name: '名稱', type: 'title' },
  Sta1: {
    name: '狀態',
    type: 'select',
    options: [
      { id: 'opt_todo', value: '未開始', color: 'gray' },
      { id: 'opt_doing', value: '進行中', color: 'blue' },
      { id: 'opt_done', value: '已完成', color: 'green' },
    ],
  },
  Tag1: {
    name: '標籤',
    type: 'multiSelect',
    options: [
      { id: 'opt_dev', value: '開發', color: 'blue' },
      { id: 'opt_qa', value: '測試', color: 'orange' },
    ],
  },
  Num1: { name: '數字', type: 'number' },
  Chk1: { name: '勾選', type: 'checkbox' },
  Due1: { name: '日期', type: 'date' },
};

function row(
  id: string,
  title: string,
  props: Partial<{
    Sta1: string;
    Tag1: string[];
    Num1: number;
    Chk1: boolean;
    Due1: string;
  }>,
): DatabaseRow {
  const properties: RowProperties = {
    title: { type: 'title', richText: [{ text: title }], plainText: title },
  };
  if (props.Sta1) properties.Sta1 = { type: 'select', optionId: props.Sta1 };
  if (props.Tag1) properties.Tag1 = { type: 'multiSelect', optionIds: props.Tag1 };
  if (props.Num1 !== undefined) properties.Num1 = { type: 'number', number: props.Num1 };
  if (props.Chk1 !== undefined) properties.Chk1 = { type: 'checkbox', checkbox: props.Chk1 };
  if (props.Due1) properties.Due1 = { type: 'date', start: props.Due1, end: null, includeTime: false };
  return {
    id,
    collectionId: 'c1',
    title: [{ text: title }],
    icon: null,
    cover: null,
    properties,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'u1',
    updatedBy: 'u1',
  };
}

const rows: DatabaseRow[] = [
  row('r1', '上線部署', { Sta1: 'opt_done', Tag1: ['opt_dev'], Num1: 120, Chk1: true }),
  row('r2', '測試與 QA', { Sta1: 'opt_doing', Tag1: ['opt_qa', 'opt_dev'], Num1: 48, Chk1: false }),
  row('r3', '設計稿', { Sta1: 'opt_done', Num1: 16, Chk1: true }),
  row('r4', '前端開發', { Sta1: 'opt_doing', Tag1: ['opt_dev'], Num1: 256, Chk1: false }),
  row('r5', '後端 API', { Sta1: 'opt_todo', Tag1: ['opt_dev'], Chk1: false }),
];

describe('filter', () => {
  const now = new Date('2026-01-10T00:00:00.000Z');

  it('select is / isNot', () => {
    const hit = rows.filter((r) =>
      matchesFilter(schema, r.properties, { operator: 'and', filters: [{ property: 'Sta1', operator: 'is', value: 'opt_done' }] }, now),
    );
    expect(hit.map((r) => r.id)).toEqual(['r1', 'r3']);
  });

  it('multiSelect contains 是「其中之一」', () => {
    const hit = rows.filter((r) =>
      matchesFilter(schema, r.properties, { operator: 'and', filters: [{ property: 'Tag1', operator: 'contains', value: 'opt_qa' }] }, now),
    );
    expect(hit.map((r) => r.id)).toEqual(['r2']);
  });

  it('number 比較運算子', () => {
    const hit = rows.filter((r) =>
      matchesFilter(schema, r.properties, { operator: 'and', filters: [{ property: 'Num1', operator: 'greaterThan', value: 50 }] }, now),
    );
    expect(hit.map((r) => r.id)).toEqual(['r1', 'r4']);
  });

  it('checkbox is true', () => {
    const hit = rows.filter((r) =>
      matchesFilter(schema, r.properties, { operator: 'and', filters: [{ property: 'Chk1', operator: 'is', value: true }] }, now),
    );
    expect(hit.map((r) => r.id)).toEqual(['r1', 'r3']);
  });

  it('isEmpty / isNotEmpty 不需要 value', () => {
    const empty = rows.filter((r) =>
      matchesFilter(schema, r.properties, { operator: 'and', filters: [{ property: 'Num1', operator: 'isEmpty' }] }, now),
    );
    expect(empty.map((r) => r.id)).toEqual(['r5']);
  });

  it('title contains（大小寫不敏感）', () => {
    const hit = rows.filter((r) =>
      matchesFilter(schema, r.properties, { operator: 'and', filters: [{ property: 'title', operator: 'contains', value: 'qa' }] }, now),
    );
    expect(hit.map((r) => r.id)).toEqual(['r2']);
  });

  it('or 群組', () => {
    const hit = rows.filter((r) =>
      matchesFilter(
        schema,
        r.properties,
        {
          operator: 'or',
          filters: [
            { property: 'Sta1', operator: 'is', value: 'opt_todo' },
            { property: 'Num1', operator: 'greaterThan', value: 200 },
          ],
        },
        now,
      ),
    );
    expect(hit.map((r) => r.id).sort()).toEqual(['r4', 'r5']);
  });

  it('空的 filter group 等於不過濾', () => {
    expect(matchesFilter(schema, rows[0]!.properties, { operator: 'and', filters: [] }, now)).toBe(true);
    expect(matchesFilter(schema, rows[0]!.properties, null, now)).toBe(true);
  });

  it('日期 relative「今天」', () => {
    const today = now.toISOString().slice(0, 10);
    const r = row('rx', '今天到期', { Due1: today });
    expect(
      matchesFilter(schema, r.properties, { operator: 'and', filters: [{ property: 'Due1', operator: 'is', value: { kind: 'relative', relative: 'today' } }] }, now),
    ).toBe(true);
  });
});

describe('sort', () => {
  it('數字升冪，空值排最後', () => {
    const sorted = sortRows(rows, schema, [{ property: 'Num1', direction: 'ascending' }]);
    expect(sorted.map((r) => r.id)).toEqual(['r3', 'r2', 'r1', 'r4', 'r5']);
  });

  it('降冪', () => {
    const sorted = sortRows(rows, schema, [{ property: 'Num1', direction: 'descending' }]);
    expect(sorted[0]!.id).toBe('r4');
  });

  it('沒有 sort 時保持原順序', () => {
    expect(sortRows(rows, schema, []).map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });
});

describe('group', () => {
  it('select 分組會保留空泳道，未設定排最後', () => {
    const groups = buildGroups(rows, schema, 'Sta1', false);
    expect(groups.map((g) => g.key)).toEqual(['opt_todo', 'opt_doing', 'opt_done', null]);
    expect(groups.find((g) => g.key === 'opt_done')!.count).toBe(2);
    expect(groups.find((g) => g.key === 'opt_done')!.label).toBe('已完成');
    expect(groups.find((g) => g.key === null)!.count).toBe(0);
  });

  it('hideEmptyGroups 會拿掉空泳道', () => {
    const groups = buildGroups(rows, schema, 'Sta1', true);
    expect(groups.every((g) => g.count > 0)).toBe(true);
  });
});

describe('aggregate', () => {
  it('sum / average / countNotEmpty / checked', () => {
    expect(aggregate(rows, schema, 'Num1', 'sum')).toBe(440);
    expect(aggregate(rows, schema, 'Num1', 'average')).toBe(110);
    expect(aggregate(rows, schema, 'Num1', 'countNotEmpty')).toBe(4);
    expect(aggregate(rows, schema, 'Chk1', 'checked')).toBe(2);
    expect(aggregate(rows, schema, 'Num1', 'count')).toBe(5);
  });
});

describe('runQuery', () => {
  it('filter + sort + 分頁 + 總數', () => {
    const result = runQuery({
      schema,
      query: {
        filter: { operator: 'and', filters: [{ property: 'Tag1', operator: 'contains', value: 'opt_dev' }] },
        sort: [{ property: 'Num1', direction: 'descending' }],
      },
      rows,
      limit: 2,
      offset: 0,
    });
    expect(result.total).toBe(4);
    expect(result.rows.map((r) => r.id)).toEqual(['r4', 'r1']);
    expect(result.hasMore).toBe(true);
    expect(result.nextOffset).toBe(2);
  });

  it('search 會比對標題與欄位顯示值', () => {
    const result = runQuery({ schema, query: {}, rows, limit: 50, offset: 0, search: '部署' });
    expect(result.rows.map((r) => r.id)).toEqual(['r1']);
  });

  it('groupBy 時回 groups 且 rows 是攤平後的順序', () => {
    const result = runQuery({
      schema,
      query: { groupBy: { property: 'Sta1', hideEmptyGroups: true } },
      rows,
      limit: 50,
      offset: 0,
    });
    expect(result.groups).toBeDefined();
    expect(result.rows).toHaveLength(5);
    expect(result.groups!.reduce((n, g) => n + g.count, 0)).toBe(5);
  });

  it('aggregations 只回非 none 的欄位', () => {
    const result = runQuery({
      schema,
      query: { aggregations: { Num1: 'sum', Chk1: 'none' } },
      rows,
      limit: 50,
      offset: 0,
    });
    expect(result.aggregations).toEqual([{ property: 'Num1', function: 'sum', value: 440 }]);
  });
});
