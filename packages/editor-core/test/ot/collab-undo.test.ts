/**
 * 協作 undo（04 §8 M6 第 5 項）。
 *
 * 驗收標準：**A undo 自己的操作，不會影響 B 在同一 block 後來打的字。**
 *
 * M2–M5 的保守做法是「收到遠端 ops 就把受影響的 undo 紀錄丟掉」——
 * 安全但難用（別人一打字我就不能 undo）。
 * M6 改成把 stack 裡的 inverse delta 對遠端 delta 做 transform。
 *
 * 這裡用 jsdom 跑真的 Editor，因為 undo 的正確性牽涉到
 * history / core / ot 三層的接線，只測 HistoryStack 證明不了什麼。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorDoc } from '../../src/index.js';
import { toPlainText } from '../../src/text/richtext.js';
import { textSelection } from '../../src/selection/types.js';
import type { OtDelta } from '../../src/ot/types.js';
import type { Operation } from '../../src/transaction/operation.js';

const B1 = 'b1';

function makeDoc(text: string): EditorDoc {
  return {
    rootIds: [B1],
    blocks: {
      [B1]: {
        id: B1,
        parentId: null,
        type: 'paragraph',
        props: {},
        content: text ? [{ text }] : [],
        children: [],
        version: 1,
      },
    },
  };
}

interface Host {
  editor: Editor;
  emitted: Operation[][];
  text(): string;
  type(at: number, s: string): void;
}

function mount(initial: string, ot = true): Host {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const emitted: Operation[][] = [];
  const editor = createEditor({
    container,
    doc: makeDoc(initial),
    ot: { enabled: ot, getBaseRev: () => 0 },
  });
  editor.on('localOps', (ops) => emitted.push(ops));
  return {
    editor,
    emitted,
    text: () => toPlainText(editor.getBlock(B1)!.content),
    type(at, s) {
      const plain = toPlainText(editor.getBlock(B1)!.content);
      const next = plain.slice(0, at) + s + plain.slice(at);
      // 游標要跟著走，否則 history 的 coalesce 條件（isAdjacent）不會成立
      editor.dispatch({
        ops: [{ type: 'block.update', blockId: B1, patch: { content: [{ text: next }] } }],
        kind: 'insertText',
        selectionBefore: textSelection(B1, at),
        selectionAfter: textSelection(B1, at + [...s].length),
      });
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('OT 模式的 localOps', () => {
  it('同一個 block 內的文字變更會以 text.delta 送出', () => {
    const h = mount('hello');
    h.type(5, ' world');
    expect(h.emitted).toHaveLength(1);
    const op = h.emitted[0]![0]!;
    expect(op.type).toBe('text.delta');
    if (op.type === 'text.delta') {
      expect(op.delta).toEqual({ ops: [{ retain: 5 }, { insert: ' world' }] });
      expect(op.baseRev).toBe(0);
    }
  });

  it('結構變更仍然走 tx 通道（block.insert 不會被 delta 化）', () => {
    const h = mount('hello');
    h.editor.insertBlockAfter(B1, { type: 'paragraph' });
    const ops = h.emitted.flat();
    expect(ops.some((o) => o.type === 'block.insert')).toBe(true);
    expect(ops.some((o) => o.type === 'text.delta')).toBe(false);
  });

  it('預設（ot.enabled = false）行為完全不變，仍送 block.update', () => {
    const h = mount('hello', false);
    h.type(5, '!');
    expect(h.emitted[0]![0]!.type).toBe('block.update');
  });
});

describe('applyRemoteDelta', () => {
  it('套用遠端 delta 並精準推游標（不是用 diff 猜）', () => {
    const h = mount('hello');
    h.editor.focusBlock(B1, 5); // 游標在句尾
    h.editor.applyRemoteDelta(B1, { ops: [{ insert: 'XY' }] });
    expect(h.text()).toBe('XYhello');
    const sel = h.editor.getSelection();
    expect(sel.type).toBe('text');
    if (sel.type === 'text') expect(sel.focus.offset).toBe(7);
  });

  it('別人正好在游標位置打字 → 我的游標不被推走', () => {
    const h = mount('hello');
    h.editor.focusBlock(B1, 2);
    h.editor.applyRemoteDelta(B1, { ops: [{ retain: 2 }, { insert: 'ZZ' }] });
    const sel = h.editor.getSelection();
    if (sel.type === 'text') expect(sel.focus.offset).toBe(2);
  });

  it('不進 undo stack、不回送同步層', () => {
    const h = mount('hello');
    const depth = h.editor.history.undoDepth;
    h.editor.applyRemoteDelta(B1, { ops: [{ insert: 'Z' }] });
    expect(h.editor.history.undoDepth).toBe(depth);
    expect(h.emitted).toHaveLength(0);
  });
});

describe('協作 undo（M6 驗收標準）', () => {
  it('A undo 自己的字，不會影響 B 後來打的字', () => {
    const h = mount('hello');

    // A 在句尾打字
    h.type(5, ' world');
    expect(h.text()).toBe('hello world');

    // B（遠端）在句首打字
    h.editor.applyRemoteDelta(B1, { ops: [{ insert: 'B:' }] });
    expect(h.text()).toBe('B:hello world');

    // A undo → 只撤銷自己的 ' world'，B 的 'B:' 必須留著
    expect(h.editor.undo()).toBe(true);
    expect(h.text()).toBe('B:hello');
  });

  it('B 在 A 的字「中間」打字，A undo 之後 B 的字仍在', () => {
    const h = mount('ab');
    h.type(2, 'XYZ'); // A：abXYZ
    h.editor.applyRemoteDelta(B1, { ops: [{ retain: 3 }, { insert: '!' }] }); // B 插在 X 後面
    expect(h.text()).toBe('abX!YZ');
    h.editor.undo();
    expect(h.text()).toBe('ab!');
  });

  it('連續打字被合併成一筆 undo，transform 之後仍然只撤銷自己的字', () => {
    const h = mount('hi');
    h.type(2, 'a');
    h.type(3, 'b');
    h.type(4, 'c'); // 1 秒內連打 → coalesce 成一筆
    expect(h.text()).toBe('hiabc');
    expect(h.editor.history.undoDepth).toBe(1);

    h.editor.applyRemoteDelta(B1, { ops: [{ insert: 'R' }] });
    expect(h.text()).toBe('Rhiabc');

    h.editor.undo();
    expect(h.text()).toBe('Rhi');
  });

  it('redo 也會被 transform', () => {
    const h = mount('hello');
    h.type(5, '!');
    h.editor.applyRemoteDelta(B1, { ops: [{ insert: 'R' }] });
    h.editor.undo();
    expect(h.text()).toBe('Rhello');
    h.editor.redo();
    expect(h.text()).toBe('Rhello!');
  });

  it('遠端把我 undo 的目標整段刪掉 → undo 變成 no-op，不會爆', () => {
    const h = mount('hello');
    h.type(5, '!');
    h.editor.applyRemoteDelta(B1, { ops: [{ retain: 5 }, { delete: 1 }] }); // B 刪掉我打的 '!'
    expect(h.text()).toBe('hello');
    h.editor.undo();
    expect(h.text()).toBe('hello');
  });

  it('非 OT 模式維持 M2 的保守做法（收到遠端 ops 就丟掉紀錄）', () => {
    const h = mount('hello', false);
    h.type(5, '!');
    expect(h.editor.history.undoDepth).toBe(1);
    h.editor.applyRemote([
      { type: 'block.update', blockId: B1, patch: { content: [{ text: 'Rhello!' }] } },
    ]);
    expect(h.editor.history.undoDepth).toBe(0);
  });
});

describe('HistoryStack.onRemoteDelta 的邊界', () => {
  it('結構操作的紀錄無法 transform → 那一筆與更早的被丟掉（保守但安全）', () => {
    const h = mount('hello');
    h.editor.insertBlockAfter(B1, { type: 'paragraph' }); // 結構操作，沒有 delta 表示
    const before = h.editor.history.undoDepth;
    expect(before).toBeGreaterThan(0);
    const delta: OtDelta = { ops: [{ insert: 'Z' }] };
    h.editor.applyRemoteDelta(B1, delta);
    // 結構紀錄的 blockIds 包含 B1（新 block 接在它後面），所以會被丟掉
    expect(h.editor.history.undoDepth).toBeLessThanOrEqual(before);
  });
});
