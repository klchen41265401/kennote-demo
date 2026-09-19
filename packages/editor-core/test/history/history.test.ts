import { describe, expect, it } from 'vitest';
import { HistoryStack } from '../../src/history/stack.js';
import { canCoalesce, isAdjacent } from '../../src/history/coalesce.js';
import type { HistoryEntry } from '../../src/history/types.js';
import type { Transaction } from '../../src/transaction/transaction.js';
import { textSelection } from '../../src/selection/types.js';

function entry(partial: Partial<HistoryEntry>): HistoryEntry {
  return {
    ops: [],
    inverseOps: [],
    selectionBefore: textSelection('a', 0),
    selectionAfter: textSelection('a', 1),
    timestamp: 0,
    kind: 'insertText',
    blockIds: ['a'],
    ...partial,
  };
}

function typingTx(blockId: string, from: number, to: number, at: number): Transaction {
  return {
    ops: [{ type: 'block.update', blockId, patch: { content: [{ text: 'x' }] } }],
    inverseOps: [{ type: 'block.update', blockId, patch: { content: [] } }],
    selectionBefore: textSelection(blockId, from),
    selectionAfter: textSelection(blockId, to),
    timestamp: at,
    kind: 'insertText',
    blockIds: [blockId],
    source: 'user',
  };
}

describe('coalesce 規則', () => {
  it('連續且同一 block、同類型、時間窗內 → 可合併', () => {
    expect(canCoalesce(entry({ timestamp: 0 }), entry({ timestamp: 100, selectionBefore: textSelection('a', 1) }))).toBe(true);
  });

  it('停頓超過 1000ms → 斷開', () => {
    expect(canCoalesce(entry({ timestamp: 0 }), entry({ timestamp: 1000, selectionBefore: textSelection('a', 1) }))).toBe(false);
  });

  it('跨 block → 不合併', () => {
    expect(
      canCoalesce(entry({ timestamp: 0 }), entry({ timestamp: 10, blockIds: ['b'], selectionBefore: textSelection('b', 1) })),
    ).toBe(false);
  });

  it('格式與結構操作永不合併', () => {
    expect(canCoalesce(entry({ kind: 'format' }), entry({ kind: 'format', timestamp: 10 }))).toBe(false);
    expect(canCoalesce(entry({ kind: 'structural' }), entry({ kind: 'structural', timestamp: 10 }))).toBe(false);
  });

  it('不同類型不合併（打字 vs 刪除）', () => {
    expect(canCoalesce(entry({ kind: 'insertText' }), entry({ kind: 'deleteText', timestamp: 10 }))).toBe(false);
  });

  it('位置不連續 → 不合併（使用者用滑鼠跳到別處繼續打）', () => {
    expect(canCoalesce(entry({ timestamp: 0 }), entry({ timestamp: 10, selectionBefore: textSelection('a', 50) }))).toBe(false);
  });

  it('isAdjacent 要求 collapsed 且位置相接', () => {
    expect(isAdjacent(textSelection('a', 5), textSelection('a', 5))).toBe(true);
    expect(isAdjacent(textSelection('a', 5), textSelection('a', 5, 9))).toBe(false);
    expect(isAdjacent(textSelection('a', 5), textSelection('b', 5))).toBe(false);
  });
});

describe('HistoryStack（假時鐘）', () => {
  it('打 100 個字只需要一次 undo', () => {
    let now = 0;
    const stack = new HistoryStack({ now: () => now });
    for (let i = 0; i < 100; i++) {
      now += 30; // 每 30ms 打一個字
      stack.record(typingTx('a', i, i + 1, now));
    }
    expect(stack.undoDepth).toBe(1);
    const popped = stack.popUndo()!;
    expect(popped.ops).toHaveLength(100);
    expect(stack.undoDepth).toBe(0);
  });

  it('停頓 1 秒後再打 → 分成兩段，undo 只還原第二段', () => {
    let now = 0;
    const stack = new HistoryStack({ now: () => now });
    for (let i = 0; i < 5; i++) {
      now += 30;
      stack.record(typingTx('a', i, i + 1, now));
    }
    now += 1000; // 停頓 1 秒
    for (let i = 5; i < 9; i++) {
      stack.record(typingTx('a', i, i + 1, now));
      now += 30;
    }
    expect(stack.undoDepth).toBe(2);
    const second = stack.popUndo()!;
    expect(second.ops).toHaveLength(4); // 只還原第二段
    expect(stack.undoDepth).toBe(1);
    const first = stack.popUndo()!;
    expect(first.ops).toHaveLength(5);
  });

  it('undo 之後 redo 可以還原回來', () => {
    const stack = new HistoryStack({ now: () => 0 });
    stack.record(typingTx('a', 0, 1, 0));
    expect(stack.canUndo).toBe(true);
    stack.popUndo();
    expect(stack.canRedo).toBe(true);
    stack.popRedo();
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it('新操作會清空 redo stack', () => {
    let now = 0;
    const stack = new HistoryStack({ now: () => now });
    stack.record(typingTx('a', 0, 1, now));
    stack.popUndo();
    expect(stack.canRedo).toBe(true);
    now += 5000;
    stack.record(typingTx('a', 0, 1, now));
    expect(stack.canRedo).toBe(false);
  });

  it('breakpoint 強制切斷合併', () => {
    let now = 0;
    const stack = new HistoryStack({ now: () => now });
    stack.record(typingTx('a', 0, 1, now));
    stack.breakpoint();
    now += 10;
    stack.record(typingTx('a', 1, 2, now));
    expect(stack.undoDepth).toBe(2);
  });

  it('上限 200 筆，超過丟最舊的', () => {
    let now = 0;
    const stack = new HistoryStack({ max: 3, now: () => now });
    for (let i = 0; i < 10; i++) {
      now += 5000; // 每次都超過時間窗 → 不合併
      stack.record(typingTx('a', i, i + 1, now));
    }
    expect(stack.undoDepth).toBe(3);
  });

  it('收到遠端 ops 時丟掉受影響的 undo 紀錄（M1-M5 的保守做法）', () => {
    let now = 0;
    const stack = new HistoryStack({ now: () => now });
    now += 5000;
    stack.record(typingTx('a', 0, 1, now));
    now += 5000;
    stack.record(typingTx('b', 0, 1, now));
    expect(stack.undoDepth).toBe(2);
    stack.onRemoteOps([{ type: 'block.update', blockId: 'a', patch: {} }]);
    expect(stack.undoDepth).toBe(1); // a 那筆與更早的被丟掉
  });

  it('clear 清空一切', () => {
    const stack = new HistoryStack({ now: () => 0 });
    stack.record(typingTx('a', 0, 1, 0));
    stack.clear();
    expect(stack.canUndo).toBe(false);
  });
});
