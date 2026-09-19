/**
 * BUG-7（tab 列溢位時選中的檢視要留在可見清單）
 * 與 BUG-8（新增的欄位要接在 format.properties 尾端）的純邏輯回歸。
 *
 * 這兩條都是「看得到、但自動化很難抓」的 bug：
 * BUG-7 只有在 tab 放不下的寬度才會出現，BUG-8 要重整之後才看得出順序不對，
 * 所以把判斷抽成純函式在這裡釘住。
 */
import { describe, expect, it } from 'vitest';
import type { CollectionSchema, ViewFormat } from '@kennote/shared-types';
import { splitViewTabs } from '../DatabaseHeader';
import { alignViewProperties, defaultPropertyWidth, visibleProperties } from '../views/types';

const schema: CollectionSchema = {
  title: { name: '名稱', type: 'title' },
  Mul1: { name: '標籤', type: 'multiSelect', options: [] },
  Sel1: { name: '狀態', type: 'select', options: [] },
  Dat1: { name: '日期', type: 'date' },
};

const views = [
  { id: 'v1', name: '表格' },
  { id: 'v2', name: '看板' },
  { id: 'v3', name: '清單' },
  { id: 'v4', name: '圖庫' },
  { id: 'v5', name: '日曆' },
  { id: 'v6', name: '時程表' },
];

describe('splitViewTabs（BUG-7）', () => {
  it('全部放得下時就是原順序', () => {
    const { shownViews, hiddenViews } = splitViewTabs(views, 'v1', views.length);
    expect(shownViews.map((v) => v.id)).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
    expect(hiddenViews).toEqual([]);
  });

  it('選中的檢視本來就看得到時，不動可見清單', () => {
    const { shownViews, hiddenViews } = splitViewTabs(views, 'v2', 4);
    expect(shownViews.map((v) => v.id)).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(hiddenViews.map((v) => v.id)).toEqual(['v5', 'v6']);
  });

  it('⭐ 選中的檢視被收起來時，擠進最後一格（否則整列沒有 aria-selected 的 tab）', () => {
    const { shownViews, hiddenViews } = splitViewTabs(views, 'v6', 4);
    expect(shownViews.map((v) => v.id)).toEqual(['v1', 'v2', 'v3', 'v6']);
    expect(shownViews.at(-1)?.id).toBe('v6');
    // 被擠掉的 v4 退回「還有 N 個…」，而且不會重複出現
    expect(hiddenViews.map((v) => v.id)).toEqual(['v4', 'v5']);
    expect(shownViews.length + hiddenViews.length).toBe(views.length);
  });

  it('只放得下 1 顆時，那一顆就是選中的那個', () => {
    const { shownViews, hiddenViews } = splitViewTabs(views, 'v5', 1);
    expect(shownViews.map((v) => v.id)).toEqual(['v5']);
    expect(hiddenViews.map((v) => v.id)).toEqual(['v1', 'v2', 'v3', 'v4', 'v6']);
  });

  it('找不到選中的檢視時退回單純切片（不會炸）', () => {
    const { shownViews, hiddenViews } = splitViewTabs(views, 'nope', 2);
    expect(shownViews.map((v) => v.id)).toEqual(['v1', 'v2']);
    expect(hiddenViews.map((v) => v.id)).toEqual(['v3', 'v4', 'v5', 'v6']);
  });
});

describe('alignViewProperties（BUG-8）', () => {
  const format: ViewFormat = {
    properties: [
      { property: 'title', visible: true, width: 320 },
      { property: 'Mul1', visible: true, width: 160 },
      { property: 'Sel1', visible: false },
      { property: 'Dat1', visible: true, width: 200 },
    ],
  };

  it('⭐ 新欄位接在尾端，不是 jsonb 的 key 順序', () => {
    // 'Aa1' 依 jsonb 的 key 排序（先比長度、再比 byte）會排在 Dat1 前面
    const next = alignViewProperties(format, { ...schema, Aa1: { name: '文字', type: 'text' } }, [
      'Aa1',
    ]);
    expect(next.map((p) => p.property)).toEqual(['title', 'Mul1', 'Sel1', 'Dat1', 'Aa1']);
    expect(next.at(-1)).toEqual({ property: 'Aa1', visible: true, width: 160 });
  });

  it('連加三個欄位時照新增順序排在尾端', () => {
    const grown: CollectionSchema = {
      ...schema,
      Ccc: { name: '核取', type: 'checkbox' },
      Aaa: { name: '文字', type: 'text' },
      Bbb: { name: '數字', type: 'number' },
    };
    const next = alignViewProperties(format, grown, ['Aaa', 'Bbb', 'Ccc']);
    expect(next.map((p) => p.property)).toEqual([
      'title',
      'Mul1',
      'Sel1',
      'Dat1',
      'Aaa',
      'Bbb',
      'Ccc',
    ]);
  });

  it('保留既有的 width / visible，不會把隱藏的欄位變回顯示', () => {
    const next = alignViewProperties(format, schema, []);
    expect(next).toEqual(format.properties);
  });

  it('format 沒列到的既有欄位補在「這次新增的」前面', () => {
    const partial: ViewFormat = { properties: [{ property: 'title', visible: true, width: 320 }] };
    const next = alignViewProperties(partial, { ...schema, Zz1: { name: '網址', type: 'url' } }, [
      'Zz1',
    ]);
    expect(next.map((p) => p.property)).toEqual(['title', 'Mul1', 'Sel1', 'Dat1', 'Zz1']);
  });

  it('schema 已經沒有的欄位會被清掉（delete op）', () => {
    const { Sel1: _removed, ...rest } = schema;
    const next = alignViewProperties(format, rest, []);
    expect(next.map((p) => p.property)).toEqual(['title', 'Mul1', 'Dat1']);
  });

  it('冪等：後端已經補過一次，前端再補一次結果一樣', () => {
    const grown = { ...schema, Aa1: { name: '文字', type: 'text' as const } };
    const once = alignViewProperties(format, grown, ['Aa1']);
    const twice = alignViewProperties({ ...format, properties: once }, grown, ['Aa1']);
    expect(twice).toEqual(once);
  });

  it('接上 visibleProperties 之後表格欄序就是新增順序', () => {
    const grown = { ...schema, Aa1: { name: '文字', type: 'text' as const } };
    const next = alignViewProperties(format, grown, ['Aa1']);
    const columns = visibleProperties(grown, { ...format, properties: next });
    // Sel1 是隱藏的，所以不在欄位裡；Aa1 在最後
    expect(columns.map((c) => c.property)).toEqual(['title', 'Mul1', 'Dat1', 'Aa1']);
  });

  it('預設寬度跟後端 defaultViewFormat 一致', () => {
    expect(defaultPropertyWidth('title')).toBe(320);
    expect(defaultPropertyWidth('Aa1')).toBe(160);
  });
});
