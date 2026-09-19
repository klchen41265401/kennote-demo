/**
 * 功能 QA 第四輪（資料庫缺口）的兩條純邏輯回歸：
 *
 *  1. **CSV 欄序**（第三輪 §1.3）：匯出要依目前視圖的 `format.properties`，
 *     而且 title 一定在第一欄。以前走 `Object.keys(schema)` ＝ jsonb 的 key 排序，
 *     `名稱` 會被排到最後一欄。
 *  2. **BUG-11**：relation 的 `dualProperty` 指到目標 schema 不存在（或型別不對）
 *     的欄位時要當場擋下來，而不是在目標列的 properties 裡寫出孤兒屬性。
 */
import { describe, expect, it } from 'vitest';
import type { CollectionSchema, FieldDefinition, ViewFormat } from '@kennote/shared-types';
import { assertDualPropertyExists, csvColumns } from '../src/modules/databases/service.js';

const schema: CollectionSchema = {
  Dat1: { name: '日期', type: 'date' },
  Num1: { name: '數字', type: 'number' },
  title: { name: '名稱', type: 'title' },
  Rel1: { name: '關聯', type: 'relation', collectionId: null },
};

describe('csvColumns', () => {
  it('⭐ title 排第一欄，其餘照視圖的 properties 順序', () => {
    const format: ViewFormat = {
      properties: [
        { property: 'Num1', visible: true },
        { property: 'title', visible: true },
        { property: 'Dat1', visible: true },
      ],
    };
    expect(csvColumns(schema, format)).toEqual(['title', 'Num1', 'Dat1']);
  });

  it('隱藏的欄位不匯出', () => {
    const format: ViewFormat = {
      properties: [
        { property: 'title', visible: true },
        { property: 'Num1', visible: false },
        { property: 'Dat1', visible: true },
      ],
    };
    expect(csvColumns(schema, format)).toEqual(['title', 'Dat1']);
  });

  it('視圖沒有 properties 時退回 schema 順序，但 title 仍然排第一', () => {
    expect(csvColumns(schema, undefined)).toEqual(['title', 'Dat1', 'Num1', 'Rel1']);
  });

  it('視圖把 title 藏起來時也會補回第一欄（CSV 至少要有標題）', () => {
    const format: ViewFormat = {
      properties: [
        { property: 'title', visible: false },
        { property: 'Num1', visible: true },
      ],
    };
    expect(csvColumns(schema, format)).toEqual(['title', 'Num1']);
  });
});

describe('assertDualPropertyExists（BUG-11）', () => {
  const target: CollectionSchema = {
    title: { name: '名稱', type: 'title' },
    Rel9: { name: '反向', type: 'relation', collectionId: 'c-a' },
    Txt9: { name: '文字', type: 'text' },
  };
  const loader = async (id: string) => (id === 'c-b' ? target : null);

  function relation(patch: Partial<Extract<FieldDefinition, { type: 'relation' }>>): FieldDefinition {
    return { name: '關聯', type: 'relation', collectionId: 'c-b', ...patch } as FieldDefinition;
  }

  it('dualProperty 在目標 schema 裡，而且是 relation → 放行', async () => {
    await expect(
      assertDualPropertyExists(loader, 'Rel1', relation({ dualProperty: 'Rel9' })),
    ).resolves.toBeUndefined();
  });

  it('沒有 dualProperty（單向關聯）→ 放行', async () => {
    await expect(assertDualPropertyExists(loader, 'Rel1', relation({}))).resolves.toBeUndefined();
  });

  it('⭐ dualProperty 指到不存在的欄位 → 擋下來', async () => {
    await expect(
      assertDualPropertyExists(loader, 'Rel1', relation({ dualProperty: 'nope' })),
    ).rejects.toThrow(/沒有欄位/);
  });

  it('dualProperty 指到的欄位不是 relation → 擋下來', async () => {
    await expect(
      assertDualPropertyExists(loader, 'Rel1', relation({ dualProperty: 'Txt9' })),
    ).rejects.toThrow(/不是關聯欄位/);
  });

  it('目標資料庫不存在 → 擋下來', async () => {
    await expect(
      assertDualPropertyExists(loader, 'Rel1', relation({ collectionId: 'c-x', dualProperty: 'Rel9' })),
    ).rejects.toThrow(/目標資料庫不存在/);
  });

  it('設了反向欄位卻沒有目標資料庫 → 擋下來', async () => {
    await expect(
      assertDualPropertyExists(loader, 'Rel1', relation({ collectionId: null, dualProperty: 'Rel9' })),
    ).rejects.toThrow(/沒有指定目標資料庫/);
  });
});
