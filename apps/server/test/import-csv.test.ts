/**
 * CSV 解析與欄位型別推斷（純邏輯，不需要資料庫）。
 */
import { describe, expect, it } from 'vitest';
import { inferFieldType, parseCsv, planCsvSchema, normalizeCellForImport, splitMulti } from '../src/modules/import/csv.js';

describe('parseCsv', () => {
  it('基本表頭 + 資料列', () => {
    expect(parseCsv('a,b\n1,2\n3,4\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('引號內的逗號、換行與跳脫引號', () => {
    const csv = 'name,note\n"王, 小明","第一行\n第二行"\n"他說 ""嗨""",ok\n';
    expect(parseCsv(csv)).toEqual([
      ['name', 'note'],
      ['王, 小明', '第一行\n第二行'],
      ['他說 "嗨"', 'ok'],
    ]);
  });

  it('CRLF 與 BOM（Excel 存出來的樣子）', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('空欄位與尾端空行', () => {
    expect(parseCsv('a,b,c\n1,,3\n\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });
});

describe('inferFieldType', () => {
  it('checkbox：Notion 匯出的 Yes/No', () => {
    expect(inferFieldType(['Yes', 'No', 'Yes'])).toBe('checkbox');
    expect(inferFieldType(['true', 'false'])).toBe('checkbox');
    expect(inferFieldType(['是', '否', ''])).toBe('checkbox');
  });

  it('number：含千分位與百分比', () => {
    expect(inferFieldType(['1', '2', '3'])).toBe('number');
    expect(inferFieldType(['1,234', '5,678.9'])).toBe('number');
    expect(inferFieldType(['12%', '3%'])).toBe('number');
  });

  it('date：ISO、斜線、Notion 的英文長格式', () => {
    expect(inferFieldType(['2026-10-01', '2026-09-20'])).toBe('date');
    expect(inferFieldType(['2026/10/1', '2026/9/20'])).toBe('date');
    expect(inferFieldType(['January 31, 2026', 'March 1, 2026'])).toBe('date');
    expect(inferFieldType(['2026-10-01T09:00:00.000Z'])).toBe('date');
  });

  it('url / email', () => {
    expect(inferFieldType(['https://a.com/x', 'http://b.org'])).toBe('url');
    expect(inferFieldType(['a@b.com', 'c@d.org'])).toBe('email');
  });

  it('select：重複度高的短字串', () => {
    expect(inferFieldType(['未開始', '進行中', '已完成', '進行中', '未開始', '已完成'])).toBe('select');
  });

  it('multiSelect：逗號分隔的標籤', () => {
    expect(inferFieldType(['設計,開發', '開發', '設計,測試,開發'])).toBe('multiSelect');
  });

  it('text：長且幾乎都不重複', () => {
    const values = Array.from({ length: 10 }, (_, i) => `這是第 ${i} 段很長很長很長的描述文字，長到不該被當成選項`);
    expect(inferFieldType(values)).toBe('text');
  });

  it('全空 → text', () => {
    expect(inferFieldType(['', '  ', ''])).toBe('text');
  });

  it('splitMulti 去掉空白與空值', () => {
    expect(splitMulti(' a , b ,, c ')).toEqual(['a', 'b', 'c']);
  });
});

describe('planCsvSchema', () => {
  const rows = parseCsv(
    '名稱,狀態,負責人,截止日,完成,連結,預估工時\n' +
      '設計資料模型,進行中,Ken,2026-10-01,No,https://example.com/a,8\n' +
      '寫搜尋斷詞,未開始,Ken,2026-10-05,No,https://example.com/b,13\n' +
      '打包匯出,已完成,Amy,2026-09-20,Yes,https://example.com/c,5\n',
  );

  it('第一欄一定是 title', () => {
    const plan = planCsvSchema(rows);
    expect(plan.schema.title).toEqual({ name: '名稱', type: 'title' });
    expect(plan.columns[0]).toMatchObject({ index: 0, propertyId: 'title', type: 'title' });
  });

  it('其餘欄位型別推斷正確（M6 驗收標準：database 欄位型別正確對應）', () => {
    const plan = planCsvSchema(rows);
    const byName = Object.fromEntries(plan.columns.map((c) => [c.name, c.type]));
    expect(byName['狀態']).toBe('select');
    expect(byName['負責人']).toBe('select');
    expect(byName['截止日']).toBe('date');
    expect(byName['完成']).toBe('checkbox');
    expect(byName['連結']).toBe('url');
    expect(byName['預估工時']).toBe('number');
  });

  it('select 會把出現過的值收成選項', () => {
    const plan = planCsvSchema(rows);
    const statusId = plan.columns.find((c) => c.name === '狀態')!.propertyId;
    const def = plan.schema[statusId] as { options: Array<{ value: string }> };
    expect(def.options.map((o) => o.value)).toEqual(['進行中', '未開始', '已完成']);
  });

  it('propertyId 合法（^[A-Za-z0-9_]{1,16}$）且不重複', () => {
    const plan = planCsvSchema(rows);
    const ids = plan.columns.map((c) => c.propertyId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_]{1,16}$/);
  });

  it('空 CSV 也給得出一個只有 title 的 schema', () => {
    const plan = planCsvSchema([]);
    expect(plan.schema.title).toBeDefined();
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('normalizeCellForImport 把 Yes/No 正規化給 checkbox 的 fromPlainText 吃', () => {
    expect(normalizeCellForImport('checkbox', 'Yes')).toBe('true');
    expect(normalizeCellForImport('checkbox', 'No')).toBe('false');
    expect(normalizeCellForImport('checkbox', '???')).toBe('');
    expect(normalizeCellForImport('text', ' 原樣 ')).toBe('原樣');
  });
});
