import { describe, expect, it } from 'vitest';
import type { EditorDoc } from '../../src/model/types.js';
import { applyOps, OperationError } from '../../src/transaction/apply.js';
import { invertOps } from '../../src/transaction/invert.js';
import type { Operation } from '../../src/transaction/operation.js';
import { flattenDoc } from '../../src/model/document.js';

function docOf(): EditorDoc {
  return {
    rootIds: ['a', 'b'],
    blocks: {
      a: { id: 'a', parentId: null, type: 'paragraph', props: {}, content: [{ text: 'A' }], children: ['a1'], version: 1 },
      a1: { id: 'a1', parentId: 'a', type: 'paragraph', props: {}, content: [{ text: 'A1' }], children: [], version: 1 },
      b: { id: 'b', parentId: null, type: 'paragraph', props: {}, content: [{ text: 'B' }], children: [], version: 1 },
    },
  };
}

describe('applyOps — 純函式與不可變性', () => {
  it('不修改傳入的 doc', () => {
    const doc = docOf();
    const snapshot = JSON.stringify(doc);
    applyOps(doc, [{ type: 'block.update', blockId: 'a', patch: { content: [{ text: 'changed' }] } }]);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it('空 ops 回傳同一個參考', () => {
    const doc = docOf();
    expect(applyOps(doc, [])).toBe(doc);
  });
});

describe('block.insert', () => {
  it('插在指定位置並維護 children 順序', () => {
    const next = applyOps(docOf(), [
      { type: 'block.insert', blockId: 'c', parentId: null, afterId: 'a', blockType: 'heading1', props: {}, content: [{ text: 'C' }] },
    ]);
    expect(next.rootIds).toEqual(['a', 'c', 'b']);
    expect(next.blocks.c!.type).toBe('heading1');
  });

  it('afterId 為 null → 插在最前面', () => {
    const next = applyOps(docOf(), [
      { type: 'block.insert', blockId: 'c', parentId: null, afterId: null, blockType: 'paragraph', props: {}, content: [] },
    ]);
    expect(next.rootIds).toEqual(['c', 'a', 'b']);
  });

  it('插成子層', () => {
    const next = applyOps(docOf(), [
      { type: 'block.insert', blockId: 'a2', parentId: 'a', afterId: 'a1', blockType: 'paragraph', props: {}, content: [] },
    ]);
    expect(next.blocks.a!.children).toEqual(['a1', 'a2']);
    expect(next.blocks.a2!.parentId).toBe('a');
  });

  it('id 重複 → 拋錯', () => {
    expect(() =>
      applyOps(docOf(), [{ type: 'block.insert', blockId: 'a', parentId: null, afterId: null, blockType: 'paragraph', props: {}, content: [] }]),
    ).toThrow(OperationError);
  });

  it('parent 不存在 → 拋錯', () => {
    expect(() =>
      applyOps(docOf(), [{ type: 'block.insert', blockId: 'x', parentId: 'ghost', afterId: null, blockType: 'paragraph', props: {}, content: [] }]),
    ).toThrow(OperationError);
  });

  it('content 會被 normalize', () => {
    const next = applyOps(docOf(), [
      { type: 'block.insert', blockId: 'c', parentId: null, afterId: 'b', blockType: 'paragraph', props: {}, content: [{ text: 'x' }, { text: 'y' }] },
    ]);
    expect(next.blocks.c!.content).toEqual([{ text: 'xy' }]);
  });
});

describe('block.update', () => {
  it('更新 content 並遞增 version', () => {
    const next = applyOps(docOf(), [{ type: 'block.update', blockId: 'a', patch: { content: [{ text: 'Z' }] } }]);
    expect(next.blocks.a!.content).toEqual([{ text: 'Z' }]);
    expect(next.blocks.a!.version).toBe(2);
  });

  it('baseVersion 不符 → 拋錯（樂觀鎖）', () => {
    expect(() => applyOps(docOf(), [{ type: 'block.update', blockId: 'a', patch: { content: [] }, baseVersion: 99 }])).toThrow(
      /version conflict/,
    );
  });

  it('block 不存在 → 拋錯', () => {
    expect(() => applyOps(docOf(), [{ type: 'block.update', blockId: 'ghost', patch: {} }])).toThrow(OperationError);
  });
});

describe('block.move', () => {
  it('搬到另一個 parent', () => {
    const next = applyOps(docOf(), [{ type: 'block.move', blockId: 'a1', parentId: 'b', afterId: null }]);
    expect(next.blocks.a!.children).toEqual([]);
    expect(next.blocks.b!.children).toEqual(['a1']);
    expect(next.blocks.a1!.parentId).toBe('b');
  });

  it('同層調換順序', () => {
    const next = applyOps(docOf(), [{ type: 'block.move', blockId: 'a', parentId: null, afterId: 'b' }]);
    expect(next.rootIds).toEqual(['b', 'a']);
  });

  it('循環檢測：不能搬進自己的子孫', () => {
    expect(() => applyOps(docOf(), [{ type: 'block.move', blockId: 'a', parentId: 'a1', afterId: null }])).toThrow(
      /descendant/,
    );
  });

  it('不能搬進自己', () => {
    expect(() => applyOps(docOf(), [{ type: 'block.move', blockId: 'a', parentId: 'a', afterId: null }])).toThrow();
  });
});

describe('block.delete', () => {
  it('連同子孫一起刪除', () => {
    const next = applyOps(docOf(), [{ type: 'block.delete', blockId: 'a' }]);
    expect(next.rootIds).toEqual(['b']);
    expect(next.blocks.a).toBeUndefined();
    expect(next.blocks.a1).toBeUndefined();
  });
});

describe('原子性', () => {
  it('批次中有一個 op 失敗 → 整批不套用', () => {
    const doc = docOf();
    const ops: Operation[] = [
      { type: 'block.update', blockId: 'a', patch: { content: [{ text: 'ok' }] } },
      { type: 'block.update', blockId: 'ghost', patch: {} },
    ];
    expect(() => applyOps(doc, ops)).toThrow();
    expect(doc.blocks.a!.content).toEqual([{ text: 'A' }]);
  });
});

describe('invertOps', () => {
  const roundTrip = (ops: Operation[]) => {
    const doc = docOf();
    const after = applyOps(doc, ops);
    const inverse = invertOps(doc, ops);
    const restored = applyOps(after, inverse);
    return { doc, after, restored };
  };

  it('insert 的反向是 delete', () => {
    const { doc, restored } = roundTrip([
      { type: 'block.insert', blockId: 'c', parentId: null, afterId: 'a', blockType: 'paragraph', props: {}, content: [{ text: 'C' }] },
    ]);
    expect(restored.rootIds).toEqual(doc.rootIds);
    expect(restored.blocks.c).toBeUndefined();
  });

  it('delete 的反向會把整棵子樹救回來（含順序）', () => {
    const { doc, restored } = roundTrip([{ type: 'block.delete', blockId: 'a' }]);
    expect(restored.rootIds).toEqual(doc.rootIds);
    expect(flattenDoc(restored)).toEqual(flattenDoc(doc));
    expect(restored.blocks.a1!.content).toEqual([{ text: 'A1' }]);
  });

  it('update 的反向還原舊內容', () => {
    const { restored } = roundTrip([{ type: 'block.update', blockId: 'a', patch: { content: [{ text: 'Z' }], blockType: 'quote' } }]);
    expect(restored.blocks.a!.content).toEqual([{ text: 'A' }]);
    expect(restored.blocks.a!.type).toBe('paragraph');
  });

  it('move 的反向回到原位', () => {
    const { doc, restored } = roundTrip([{ type: 'block.move', blockId: 'a1', parentId: null, afterId: 'b' }]);
    expect(restored.rootIds).toEqual(doc.rootIds);
    expect(restored.blocks.a!.children).toEqual(['a1']);
  });

  it('多個 op 的反向要反序執行', () => {
    const { doc, restored } = roundTrip([
      { type: 'block.update', blockId: 'a', patch: { content: [{ text: 'A!' }] } },
      { type: 'block.insert', blockId: 'c', parentId: null, afterId: 'a', blockType: 'paragraph', props: {}, content: [] },
      { type: 'block.delete', blockId: 'b' },
    ]);
    expect(restored.rootIds).toEqual(doc.rootIds);
    expect(restored.blocks.a!.content).toEqual([{ text: 'A' }]);
    expect(restored.blocks.b!.content).toEqual([{ text: 'B' }]);
  });
});

describe('冪等性檢查（同一批 ops 套兩次會失敗，不會默默壞掉）', () => {
  it('重複 insert 會被擋下', () => {
    const op: Operation = {
      type: 'block.insert',
      blockId: 'c',
      parentId: null,
      afterId: 'a',
      blockType: 'paragraph',
      props: {},
      content: [],
    };
    const once = applyOps(docOf(), [op]);
    expect(() => applyOps(once, [op])).toThrow(OperationError);
  });
});
