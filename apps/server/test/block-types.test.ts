import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { getBlockType, hasBlockType, listBlockTypes } from '../src/modules/blocks/block-types/index.js';
import { BLOCK_TYPES } from '@kennote/shared-types';

describe('block type registry', () => {
  it('shared-types 的每個 BlockType 都有對應的後端定義（不會漏註冊）', () => {
    for (const type of BLOCK_TYPES) {
      expect(hasBlockType(type), `缺少 ${type} 的註冊`).toBe(true);
    }
    expect(listBlockTypes()).toHaveLength(BLOCK_TYPES.length);
  });

  it('未知型別丟 INVALID_BLOCK_TYPE', () => {
    try {
      getBlockType('rating');
      throw new Error('應該要丟錯');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('INVALID_BLOCK_TYPE');
      expect((err as AppError).statusCode).toBe(400);
    }
  });

  it('todo 的 checked 會被正規化成 boolean', () => {
    expect(getBlockType('todo').validateProps({})).toEqual({ checked: false });
    expect(getBlockType('todo').validateProps({ checked: true })).toEqual({ checked: true });
  });

  it('多餘的 props 會被拒絕（strict schema）', () => {
    expect(() => getBlockType('paragraph').validateProps({ nope: 1 })).toThrow(AppError);
  });

  it('型別錯誤的 props 會被拒絕', () => {
    expect(() => getBlockType('todo').validateProps({ checked: 'yes' })).toThrow(AppError);
    expect(() => getBlockType('column').validateProps({ ratio: 5 })).toThrow(AppError);
  });

  it('能力宣告正確（divider 不能有子節點也沒有行內內容）', () => {
    const divider = getBlockType('divider');
    expect(divider.canHaveChildren).toBe(false);
    expect(divider.hasInlineContent).toBe(false);
    const paragraph = getBlockType('paragraph');
    expect(paragraph.canHaveChildren).toBe(true);
    expect(paragraph.hasInlineContent).toBe(true);
  });

  it('code 的預設語言是 plain', () => {
    expect(getBlockType('code').validateProps({})).toMatchObject({ language: 'plain' });
  });
});
