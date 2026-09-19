import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import {
  parseTransaction,
  removeChild,
  spliceChildren,
} from '../src/modules/blocks/validate-ops.js';

const PAGE = '018f0000-0000-7000-8000-000000000001';
const TX = '018f0000-0000-7000-8000-0000000000aa';
const B1 = '018f0000-0000-7000-8000-0000000000b1';
const B2 = '018f0000-0000-7000-8000-0000000000b2';

const tx = (ops: unknown[]) => ({ txId: TX, pageId: PAGE, originSessionId: 's', ops });

describe('transaction / operation 驗證', () => {
  it('合法的 block.insert 會回填 props 預設值', () => {
    const result = parseTransaction(
      tx([
        {
          type: 'block.insert',
          blockId: B1,
          parentId: null,
          afterId: null,
          blockType: 'todo',
          props: {},
          content: [{ text: '買牛奶' }],
        },
      ]),
      PAGE,
    );
    expect(result.ops).toHaveLength(1);
    const op = result.ops[0]!;
    expect(op.type).toBe('block.insert');
    if (op.type === 'block.insert') {
      expect(op.props).toEqual({ checked: false });
      expect(op.content).toEqual([{ text: '買牛奶' }]);
    }
  });

  it('沒有行內內容的 block 會被強制清空 content', () => {
    const result = parseTransaction(
      tx([
        {
          type: 'block.insert',
          blockId: B1,
          parentId: null,
          afterId: null,
          blockType: 'divider',
          props: {},
          content: [{ text: '不該存在' }],
        },
      ]),
      PAGE,
    );
    const op = result.ops[0]!;
    if (op.type === 'block.insert') expect(op.content).toEqual([]);
  });

  it('未知的 blockType 整批拒絕', () => {
    expect(() =>
      parseTransaction(
        tx([
          {
            type: 'block.insert',
            blockId: B1,
            parentId: null,
            afterId: null,
            blockType: 'rating',
            props: {},
            content: [],
          },
        ]),
        PAGE,
      ),
    ).toThrow(AppError);
  });

  it('blockId 不是 uuid → 拒絕', () => {
    expect(() =>
      parseTransaction(tx([{ type: 'block.delete', blockId: 'not-a-uuid' }]), PAGE),
    ).toThrow(AppError);
  });

  it('未知的 operation type → 拒絕', () => {
    expect(() => parseTransaction(tx([{ type: 'block.explode', blockId: B1 }]), PAGE)).toThrow(
      AppError,
    );
  });

  it('空的 ops 陣列 → 拒絕', () => {
    expect(() => parseTransaction(tx([]), PAGE)).toThrow(AppError);
  });

  it('超過 200 個 op → 拒絕', () => {
    const ops = Array.from({ length: 201 }, () => ({ type: 'block.delete', blockId: B1 }));
    expect(() => parseTransaction(tx(ops), PAGE)).toThrow(AppError);
  });

  it('pageId 與路徑不符 → 拒絕', () => {
    expect(() => parseTransaction(tx([{ type: 'block.delete', blockId: B1 }]), B2)).toThrow(
      AppError,
    );
  });

  it('page.update 的空 patch → 拒絕', () => {
    expect(() => parseTransaction(tx([{ type: 'page.update', patch: {} }]), PAGE)).toThrow(AppError);
  });

  it('richtext 結構不合法 → 拒絕', () => {
    expect(() =>
      parseTransaction(
        tx([
          {
            type: 'block.insert',
            blockId: B1,
            parentId: null,
            afterId: null,
            blockType: 'paragraph',
            props: {},
            content: [{ text: 'ok', marks: [{ t: 'bold' }] }],
          },
        ]),
        PAGE,
      ),
    ).toThrow(AppError);
  });

  it('text.delta 目前明確回未實作（M6 才啟用）', () => {
    try {
      parseTransaction(
        tx([{ type: 'text.delta', blockId: B1, delta: { ops: [] }, baseRev: 0 }]),
        PAGE,
      );
      throw new Error('應該要丟錯');
    } catch (err) {
      expect((err as AppError).code).toBe('NOT_IMPLEMENTED');
    }
  });
});

describe('children 陣列操作（排序的唯一真值）', () => {
  it('afterId = null 插到最前面', () => {
    expect(spliceChildren(['a', 'b'], 'x', null)).toEqual(['x', 'a', 'b']);
  });

  it('插在指定元素之後', () => {
    expect(spliceChildren(['a', 'b', 'c'], 'x', 'b')).toEqual(['a', 'b', 'x', 'c']);
  });

  it('afterId 不存在 → 附加到最後面', () => {
    expect(spliceChildren(['a', 'b'], 'x', 'zzz')).toEqual(['a', 'b', 'x']);
  });

  it('move 語義：先移除既有的同 id，不會重複', () => {
    expect(spliceChildren(['a', 'x', 'b'], 'x', 'b')).toEqual(['a', 'b', 'x']);
    expect(spliceChildren(['a', 'x', 'b'], 'x', null)).toEqual(['x', 'a', 'b']);
  });

  it('removeChild', () => {
    expect(removeChild(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(removeChild(['a'], 'zz')).toEqual(['a']);
  });
});
