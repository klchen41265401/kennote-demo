/**
 * 前端 Field Registry 的純邏輯測試。
 *
 * 重點是「registry 的宣告自洽」與「與後端同一組 key」：
 * 兩邊不一致時，篩選 UI 會給出後端根本不接受的運算子組合，
 * 而且是**靜默**的（送出去才 400），所以只能靠測試釘住。
 */
import { describe, expect, it } from 'vitest';
import type { CollectionSchema, FieldValue } from '@kennote/shared-types';
import { FIELD_TYPES, FIELD_TYPE_META } from '@kennote/shared-types';
import '../fields/index';
import { fieldTypeGroups, getFieldType, hasFieldType, listFieldTypes } from '../fields/types';
import { visibleProperties } from '../views/types';
import '../views/index';
import { getViewType, listViewTypes, viewTypeAvailable } from '../views/types';

const schema: CollectionSchema = {
  title: { name: '名稱', type: 'title' },
  Num1: { name: '預算', type: 'number', numberFormat: 'currencyTwd', precision: 0 },
  Sel1: {
    name: '狀態',
    type: 'select',
    options: [
      { id: 'opt_1', value: '未開始', color: 'gray' },
      { id: 'opt_2', value: '進行中', color: 'blue' },
    ],
  },
  Mul1: {
    name: '標籤',
    type: 'multiSelect',
    options: [
      { id: 'tag_1', value: '後端', color: 'purple' },
      { id: 'tag_2', value: '前端', color: 'orange' },
    ],
  },
  Dat1: { name: '截止日', type: 'date', dateFormat: 'YYYY/MM/DD' },
  Chk1: { name: '完成', type: 'checkbox' },
  Rat1: { name: '星等', type: 'rating', max: 5, icon: 'star' },
};

describe('field registry', () => {
  it('shared-types 宣告的每一種型別前端都有註冊', () => {
    for (const type of FIELD_TYPES) expect(hasFieldType(type)).toBe(true);
    expect(listFieldTypes()).toHaveLength(FIELD_TYPES.length);
  });

  it('label 與 shared-types 的 FIELD_TYPE_META 一致', () => {
    for (const fieldType of listFieldTypes()) {
      expect(fieldType.label).toBe(FIELD_TYPE_META[fieldType.type].label);
      expect(fieldType.computed).toBe(FIELD_TYPE_META[fieldType.type].computed);
    }
  });

  it('每個型別都有 Cell、運算子與預設設定', () => {
    for (const fieldType of listFieldTypes()) {
      expect(fieldType.Cell).toBeTypeOf('function');
      expect(fieldType.FilterInput).toBeTypeOf('function');
      expect(fieldType.filterOperators.length).toBeGreaterThan(0);
      const config = fieldType.defaultConfig('測試欄位');
      expect(config.name).toBe('測試欄位');
      expect(config.type).toBe(fieldType.type);
    }
  });

  it('計算欄位不提供可編輯的值（computed = true）', () => {
    for (const type of ['formula', 'rollup', 'createdTime', 'lastEditedBy'] as const) {
      expect(getFieldType(type).computed).toBe(true);
    }
  });

  it('型別選單分成基本／進階／系統，且沒有漏掉任何型別', () => {
    const groups = fieldTypeGroups();
    const total = groups.reduce((sum, g) => sum + g.types.length, 0);
    expect(total).toBe(FIELD_TYPES.length);
    expect(groups.map((g) => g.label)).toEqual(['基本', '進階', '系統']);
  });

  it('沒註冊的型別退回 text，不讓整個表格炸掉', () => {
    expect(getFieldType('nope-not-a-type').type).toBe('text');
  });
});

describe('⭐ rating：新增一個欄位型別只需要 registry + 一個資料夾', () => {
  const rating = getFieldType('rating');

  it('已註冊且宣告完整', () => {
    expect(rating.label).toBe('星等');
    expect(rating.sortable).toBe(true);
    expect(rating.groupable).toBe(true);
    expect(rating.editInline).toBe(true);
  });

  it('沿用 number 的篩選運算子與聚合函式（不必重寫）', () => {
    expect(rating.filterOperators).toEqual(getFieldType('number').filterOperators);
    expect(rating.aggregations).toEqual(getFieldType('number').aggregations);
  });

  it('toPlainText / compare / groupKeys 都能運作（匯出與排序自動支援）', () => {
    const def = schema.Rat1!;
    const three: FieldValue = { type: 'rating', rating: 3 };
    const five: FieldValue = { type: 'rating', rating: 5 };
    expect(rating.toPlainText(three, def)).toBe('3/5');
    expect(rating.compare(three, five, def)).toBeLessThan(0);
    expect(rating.groupKeys(three, def)).toEqual(['3']);
    expect(rating.groupLabel('3', def).label).toBe('3 / 5');
  });
});

describe('值的顯示與比較', () => {
  it('number 依格式化設定輸出', () => {
    const def = schema.Num1!;
    const text = getFieldType('number').toPlainText({ type: 'number', number: 1250000 }, def);
    expect(text).toContain('NT$');
    expect(text).toContain('1,250,000');
  });

  it('select 依「選項在 schema 的順序」排序，不是字母序', () => {
    const def = schema.Sel1!;
    const first: FieldValue = { type: 'select', optionId: 'opt_1' };
    const second: FieldValue = { type: 'select', optionId: 'opt_2' };
    expect(getFieldType('select').compare(first, second, def)).toBeLessThan(0);
  });

  it('空值一律排最後（與 SQL 的 NULLS LAST 一致）', () => {
    const def = schema.Num1!;
    expect(getFieldType('number').compare(undefined, { type: 'number', number: 1 }, def)).toBe(1);
    expect(getFieldType('number').compare({ type: 'number', number: 1 }, undefined, def)).toBe(-1);
  });

  it('multiSelect 的一列可以同時出現在多個泳道', () => {
    const def = schema.Mul1!;
    const keys = getFieldType('multiSelect').groupKeys(
      { type: 'multiSelect', optionIds: ['tag_1', 'tag_2'] },
      def,
    );
    expect(keys).toEqual(['tag_1', 'tag_2']);
  });

  it('checkbox 的分組一定是 true/false 兩組', () => {
    const def = schema.Chk1!;
    expect(getFieldType('checkbox').groupKeys({ type: 'checkbox', checkbox: true }, def)).toEqual([
      'true',
    ]);
    expect(getFieldType('checkbox').groupKeys(undefined, def)).toEqual(['false']);
  });

  it('date 依欄位設定格式化，並且分組到「日」', () => {
    const def = schema.Dat1!;
    const value: FieldValue = {
      type: 'date',
      start: '2026-09-30',
      end: null,
      includeTime: false,
    };
    expect(getFieldType('date').toPlainText(value, def)).toBe('2026/09/30');
    expect(getFieldType('date').groupKeys(value, def)).toEqual(['2026-09-30']);
  });
});

describe('view registry', () => {
  it('五種視圖都註冊了', () => {
    expect(listViewTypes().map((v) => v.type).sort()).toEqual(
      ['board', 'calendar', 'gallery', 'list', 'table'].sort(),
    );
  });

  it('能力宣告決定工具列要不要顯示按鈕（不寫 if viewType===）', () => {
    expect(getViewType('board').supportsGrouping).toBe(true);
    expect(getViewType('list').supportsGrouping).toBe(false);
    expect(getViewType('table').supportsAggregation).toBe(true);
  });

  it('Calendar 需要日期欄位才可用', () => {
    const calendar = getViewType('calendar');
    expect(viewTypeAvailable(calendar, schema)).toBe(true);
    expect(viewTypeAvailable(calendar, { title: { name: '名稱', type: 'title' } })).toBe(false);
  });

  it('visibleProperties：title 永遠在最前，隱藏的欄位不出現', () => {
    const columns = visibleProperties(schema, {
      properties: [
        { property: 'Num1', visible: true, width: 120 },
        { property: 'Sel1', visible: false },
        { property: 'title', visible: true, width: 320 },
      ],
    });
    expect(columns[0]?.property).toBe('title');
    expect(columns.map((c) => c.property)).not.toContain('Sel1');
    expect(columns.find((c) => c.property === 'Num1')?.width).toBe(120);
  });

  it('沒設定過的欄位預設顯示（新增欄位後立刻看得到）', () => {
    const columns = visibleProperties(schema, { properties: [{ property: 'title', visible: true }] });
    expect(columns.map((c) => c.property)).toContain('Rat1');
  });
});
