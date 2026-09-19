/**
 * Field Type Registry 的 round-trip 測試：
 * 每一種型別「寫入 → 讀回」必須等價，而且 registry 宣告的能力
 * （filterOperators / aggregations / groupable）要自洽。
 *
 * 這一組測試是 00-README §5 風險三的防線：schema 與 JSONB 值型別不一致時，
 * filter/sort 會**靜默**給出錯誤結果，所以只能靠測試釘住。
 */
import { describe, expect, it } from 'vitest';
import {
  FIELD_TYPES,
  type CollectionSchema,
  type FieldDefinition,
  type FieldValue,
} from '@kennote/shared-types';
import { AppError } from '../src/lib/errors.js';
import {
  getFieldType,
  hasFieldType,
  listFieldTypes,
} from '../src/modules/databases/field-types/index.js';
import { castValue, normalizeRowProperties, validateSchema } from '../src/modules/databases/service.js';

const USER_A = '018f0000-0000-7000-8000-00000000000a';

const schema: CollectionSchema = {
  title: { name: '名稱', type: 'title' },
  Txt1: { name: '備註', type: 'text' },
  Num1: { name: '預算', type: 'number', numberFormat: 'currencyTwd' },
  Sel1: {
    name: '狀態',
    type: 'select',
    options: [{ id: 'opt_1', value: '進行中', color: 'blue' }],
  },
  Mul1: {
    name: '標籤',
    type: 'multiSelect',
    options: [
      { id: 'tag_1', value: '後端', color: 'purple' },
      { id: 'tag_2', value: '前端', color: 'orange' },
    ],
  },
  Dat1: { name: '截止日', type: 'date' },
  Chk1: { name: '完成', type: 'checkbox' },
  Url1: { name: '連結', type: 'url' },
  Eml1: { name: '信箱', type: 'email' },
  Tel1: { name: '電話', type: 'phone' },
  Per1: { name: '負責人', type: 'person' },
  Fil1: { name: '附件', type: 'files' },
  Rat1: { name: '星等', type: 'rating', max: 5, icon: 'star' },
  Ct1: { name: '建立時間', type: 'createdTime' },
  Cb1: { name: '建立者', type: 'createdBy' },
};

describe('registry 完整性', () => {
  it('shared-types 宣告的每一種型別後端都有註冊', () => {
    for (const type of FIELD_TYPES) expect(hasFieldType(type)).toBe(true);
    expect(listFieldTypes()).toHaveLength(FIELD_TYPES.length);
  });

  it('沒註冊的型別會丟 INVALID_FIELD_TYPE 而不是 undefined', () => {
    expect(() => getFieldType('nope')).toThrow(AppError);
  });

  it('每個型別的能力宣告自洽', () => {
    for (const fieldType of listFieldTypes()) {
      expect(fieldType.filterOperators.length).toBeGreaterThan(0);
      expect(fieldType.aggregations).toContain('none');
      // 計算欄位一律不可寫入
      if (fieldType.computed) {
        expect(fieldType.normalize('x', { name: 'x', type: fieldType.type } as FieldDefinition)).toBeNull();
      }
    }
  });
});

describe('round-trip：寫入 → 讀回等價', () => {
  const cases: Array<{ property: string; input: unknown; expected: FieldValue }> = [
    {
      property: 'Txt1',
      input: '先做 MVP',
      expected: { type: 'text', richText: [{ text: '先做 MVP' }], plainText: '先做 MVP' },
    },
    { property: 'Num1', input: 1250000, expected: { type: 'number', number: 1250000 } },
    { property: 'Num1', input: '42', expected: { type: 'number', number: 42 } },
    { property: 'Sel1', input: 'opt_1', expected: { type: 'select', optionId: 'opt_1' } },
    {
      property: 'Mul1',
      input: ['tag_1', 'tag_2'],
      expected: { type: 'multiSelect', optionIds: ['tag_1', 'tag_2'] },
    },
    {
      property: 'Dat1',
      input: { start: '2026-09-30', end: null, includeTime: false },
      expected: { type: 'date', start: '2026-09-30', end: null, includeTime: false, timeZone: null },
    },
    { property: 'Chk1', input: true, expected: { type: 'checkbox', checkbox: true } },
    { property: 'Chk1', input: false, expected: { type: 'checkbox', checkbox: false } },
    {
      property: 'Url1',
      input: 'https://kenlab.org/spec',
      expected: { type: 'url', url: 'https://kenlab.org/spec' },
    },
    {
      property: 'Eml1',
      input: 'ken158ken@yahoo.com.tw',
      expected: { type: 'email', email: 'ken158ken@yahoo.com.tw' },
    },
    { property: 'Tel1', input: '+886-912-345-678', expected: { type: 'phone', phone: '+886-912-345-678' } },
    { property: 'Per1', input: [USER_A], expected: { type: 'person', userIds: [USER_A] } },
    {
      property: 'Fil1',
      input: [{ externalUrl: 'https://example.com/a.pdf', name: '外部 PDF' }],
      expected: {
        type: 'files',
        files: [{ externalUrl: 'https://example.com/a.pdf', name: '外部 PDF' }],
      },
    },
    { property: 'Rat1', input: 4, expected: { type: 'rating', rating: 4 } },
  ];

  for (const c of cases) {
    it(`${c.property} = ${JSON.stringify(c.input)}`, () => {
      const out = normalizeRowProperties(schema, { [c.property]: c.input as never });
      expect(out[c.property]).toEqual(c.expected);
      // 再正規化一次必須等冪（讀回來的值可以原封不動寫回去）
      const again = normalizeRowProperties(schema, { [c.property]: out[c.property] as never });
      expect(again[c.property]).toEqual(c.expected);
    });
  }

  it('清空 = 刪掉整個 key（03 §6.4）', () => {
    const previous = normalizeRowProperties(schema, { Num1: 5 as never });
    const cleared = normalizeRowProperties(schema, { Num1: null as never }, previous);
    expect('Num1' in cleared).toBe(false);
  });

  it('checkbox 的 false 會被存下來，不會跟「從未設定」混淆', () => {
    const out = normalizeRowProperties(schema, { Chk1: false as never });
    expect(out.Chk1).toEqual({ type: 'checkbox', checkbox: false });
  });

  it('計算欄位與系統欄位的寫入會被忽略', () => {
    const out = normalizeRowProperties(schema, {
      Ct1: { type: 'createdTime', start: '1999-01-01' } as never,
      Cb1: { type: 'createdBy', userIds: [USER_A] } as never,
    });
    expect(out.Ct1).toBeUndefined();
    expect(out.Cb1).toBeUndefined();
  });

  it('不存在的選項會被拒絕，而不是靜默存進去', () => {
    expect(() => normalizeRowProperties(schema, { Sel1: 'opt_nope' as never })).toThrow(AppError);
  });

  it('格式不對的信箱會被拒絕', () => {
    expect(() => normalizeRowProperties(schema, { Eml1: 'not-an-email' as never })).toThrow(AppError);
  });
});

describe('CSV 字串化', () => {
  it('每個型別都能轉成純文字', () => {
    const props = normalizeRowProperties(schema, {
      Txt1: '備註' as never,
      Num1: 100 as never,
      Sel1: 'opt_1' as never,
      Mul1: ['tag_1', 'tag_2'] as never,
      Rat1: 3 as never,
      Chk1: true as never,
    });
    const text = (id: string) =>
      getFieldType(schema[id]!.type).toPlainText(props[id], schema[id]!);
    expect(text('Txt1')).toBe('備註');
    expect(text('Num1')).toBe('100');
    expect(text('Sel1')).toBe('進行中');
    expect(text('Mul1')).toBe('後端, 前端');
    expect(text('Rat1')).toBe('3/5');
    expect(text('Chk1')).toBe('是');
  });
});

describe('型別切換的資料轉換（02 §4.3.1）', () => {
  it('text → number：可解析者保留', () => {
    const value: FieldValue = { type: 'text', richText: [{ text: '1,250' }], plainText: '1,250' };
    const out = castValue(value, schema.Txt1, schema.Num1!);
    expect(out.value).toEqual({ type: 'number', number: 1250 });
  });

  it('text → number：無法轉換者清空並標記 lossy', () => {
    const value: FieldValue = { type: 'text', richText: [{ text: 'abc' }], plainText: 'abc' };
    const out = castValue(value, schema.Txt1, schema.Num1!);
    expect(out.value).toBeNull();
    expect(out.lossy).toBe(true);
  });

  it('select → text：無損', () => {
    const out = castValue({ type: 'select', optionId: 'opt_1' }, schema.Sel1, schema.Txt1!);
    expect(out.value).toEqual({ type: 'text', richText: [{ text: '進行中' }], plainText: '進行中' });
  });

  it('multiSelect → select：只留第一個對得上的值', () => {
    const selectWithOptions: FieldDefinition = {
      name: '狀態',
      type: 'select',
      options: [{ id: 'sel_be', value: '後端', color: 'blue' }],
    };
    const out = castValue(
      { type: 'multiSelect', optionIds: ['tag_1', 'tag_2'] },
      schema.Mul1,
      selectWithOptions,
    );
    expect(out.value).toEqual({ type: 'select', optionId: 'sel_be' });
  });

  it('number → rating：四捨五入並夾在上限內', () => {
    const out = castValue({ type: 'number', number: 9.6 }, schema.Num1, schema.Rat1!);
    expect(out.value).toEqual({ type: 'rating', rating: 5 });
  });
});

describe('schema 驗證', () => {
  it('缺 title 會被拒絕', () => {
    expect(() => validateSchema({ Txt1: { name: '備註', type: 'text' } })).toThrow(AppError);
  });

  it('兩個 title 會被拒絕', () => {
    expect(() =>
      validateSchema({
        title: { name: 'A', type: 'title' },
        Ttl2: { name: 'B', type: 'title' },
      }),
    ).toThrow(AppError);
  });

  it('不合法的 propertyId 會被拒絕', () => {
    expect(() =>
      validateSchema({
        title: { name: 'A', type: 'title' },
        "evil'; DROP": { name: 'B', type: 'text' },
      }),
    ).toThrow(AppError);
  });

  it('公式循環引用會在存檔時被擋下（不是等到求值）', () => {
    expect(() =>
      validateSchema({
        title: { name: '名稱', type: 'title' },
        Fa: {
          name: 'A',
          type: 'formula',
          expression: 'prop("B") + 1',
          ast: null,
          resultType: 'any',
          dependsOn: [],
        },
        Fb: {
          name: 'B',
          type: 'formula',
          expression: 'prop("A") + 1',
          ast: null,
          resultType: 'any',
          dependsOn: [],
        },
      }),
    ).toThrow(AppError);
  });
});
