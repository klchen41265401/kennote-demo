/**
 * BUG-8（功能 QA 第二輪）：`PATCH /api/databases/:id/schema` 的 add op
 * 必須同時把新欄位接到**該 collection 每一個視圖**的 `format.properties` 尾端。
 *
 * 不做的話，前端 `visibleProperties()` 只能用 `Object.keys(schema)` 補在後面，
 * 而那是 Postgres jsonb 的 key 排序（先比長度、再比 byte）——
 * 依序加 `文字/數字/核取/星等/網址/信箱/電話/建立時間/建立者` 之後重整，
 * 實際看到的會是 `建立者 建立時間 核取 信箱 數字 星等 電話 文字 網址`。
 *
 * 這裡釘住 `alignViewProperties()` 這支純函式（service 在交易裡對每個視圖跑它）。
 */
import { describe, expect, it } from 'vitest';
import type { CollectionSchema, ViewFormat } from '@kennote/shared-types';
import { alignViewProperties } from '../src/modules/databases/service.js';

const schema: CollectionSchema = {
  title: { name: '名稱', type: 'title' },
  Mul1: { name: '標籤', type: 'multiSelect', options: [] },
  Sel1: { name: '狀態', type: 'select', options: [] },
  Dat1: { name: '日期', type: 'date' },
};

const format: ViewFormat = {
  properties: [
    { property: 'title', visible: true, width: 320 },
    { property: 'Mul1', visible: true, width: 160 },
    { property: 'Sel1', visible: false },
    { property: 'Dat1', visible: true, width: 200 },
  ],
};

describe('alignViewProperties', () => {
  it('⭐ add op 的新欄位排在尾端，而不是 jsonb 的 key 順序', () => {
    const grown: CollectionSchema = { ...schema, Aa1: { name: '文字', type: 'text' } };
    const next = alignViewProperties(format, grown, ['Aa1']);
    expect(next.map((p) => p.property)).toEqual(['title', 'Mul1', 'Sel1', 'Dat1', 'Aa1']);
    expect(next.at(-1)).toEqual({ property: 'Aa1', visible: true, width: 160 });
  });

  it('多個 add op 依新增順序接在尾端', () => {
    const grown: CollectionSchema = {
      ...schema,
      cb: { name: '建立者', type: 'createdBy' },
      ct: { name: '建立時間', type: 'createdTime' },
      txt: { name: '文字', type: 'text' },
    };
    // jsonb 會把它們排成 cb, ct, txt；新增順序是 txt → ct → cb
    const next = alignViewProperties(format, grown, ['txt', 'ct', 'cb']);
    expect(next.map((p) => p.property)).toEqual([
      'title',
      'Mul1',
      'Sel1',
      'Dat1',
      'txt',
      'ct',
      'cb',
    ]);
  });

  it('沒有新增時保持原樣（不會意外重排或把隱藏欄位打開）', () => {
    expect(alignViewProperties(format, schema, [])).toEqual(format.properties);
  });

  it('視圖還沒設定 properties 時，用 schema 的順序建一份', () => {
    const next = alignViewProperties(undefined, schema, []);
    expect(next.map((p) => p.property)).toEqual(['title', 'Mul1', 'Sel1', 'Dat1']);
    expect(next.every((p) => p.visible)).toBe(true);
    expect(next[0]?.width).toBe(320);
  });

  it('沒被視圖列到的既有欄位補在「這次新增的」前面', () => {
    const partial: ViewFormat = { properties: [{ property: 'title', visible: true, width: 320 }] };
    const grown: CollectionSchema = { ...schema, Zz1: { name: '網址', type: 'url' } };
    const next = alignViewProperties(partial, grown, ['Zz1']);
    expect(next.map((p) => p.property)).toEqual(['title', 'Mul1', 'Sel1', 'Dat1', 'Zz1']);
  });

  it('delete op：schema 沒有的欄位會從視圖裡清掉', () => {
    const { Sel1: _gone, ...rest } = schema;
    expect(alignViewProperties(format, rest, []).map((p) => p.property)).toEqual([
      'title',
      'Mul1',
      'Dat1',
    ]);
  });

  it('appended 裡混進不存在的 id 時直接忽略', () => {
    expect(alignViewProperties(format, schema, ['nope']).map((p) => p.property)).toEqual([
      'title',
      'Mul1',
      'Sel1',
      'Dat1',
    ]);
  });

  it('冪等：對同一份 format 重跑不會再變動（前端也會補一次）', () => {
    const grown: CollectionSchema = { ...schema, Aa1: { name: '文字', type: 'text' } };
    const once = alignViewProperties(format, grown, ['Aa1']);
    expect(alignViewProperties({ ...format, properties: once }, grown, ['Aa1'])).toEqual(once);
    expect(alignViewProperties({ ...format, properties: once }, grown, [])).toEqual(once);
  });

  it('已經在視圖裡的欄位被當成 appended 時，保留使用者調過的寬度並移到最後', () => {
    const next = alignViewProperties(format, schema, ['Mul1']);
    expect(next.map((p) => p.property)).toEqual(['title', 'Sel1', 'Dat1', 'Mul1']);
    expect(next.at(-1)?.width).toBe(160);
  });
});
