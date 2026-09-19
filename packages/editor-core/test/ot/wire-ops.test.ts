/**
 * BUG-4（`docs/qa/functional-round1.md`）的根因層測試：
 * **OT 模式下，任何覆寫既有 block content 的 op 都必須以 `text.delta` 送出。**
 *
 * 舊行為：只有「content-only 的 block.update」會被 delta 化，
 * markdown 捷徑 / setBlockType / Enter 分割這種「換型別 + 整段覆寫」照樣帶著 content
 * 走 tx 通道 —— 於是它和 OT 三狀態機 buffer 裡那筆還沒送出的 delta 撞在一起，
 * 伺服器把空白鍵那一下套回已經被覆蓋的內容上，前綴字元就留在字尾（`> quote` → `quote>`）。
 *
 * 新行為（ADR 0006 §2.9）：`block.update{blockType, props, content}` 在送出前被拆成
 *   `block.update{blockType, props}`（tx 通道，LWW）+ `text.delta`（OT 通道，同一條 rev 線）
 * —— 與伺服器廣播時的拆法完全對稱。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createEditor, type Editor, type EditorDoc } from '../../src/index.js';
import { applyBlockInputRule } from '../../src/input/input-rules.js';
import { textSelection } from '../../src/selection/types.js';
import { toPlainText } from '../../src/text/richtext.js';
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
  ops(): Operation[];
  text(): string;
  /** 模擬打字（宿主會把 localOps 交給 OT 通道） */
  type(at: number, s: string): void;
}

function mount(initial: string, options: { ot?: boolean; rev?: number } = {}): Host {
  const { ot = true, rev = 0 } = options;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const emitted: Operation[][] = [];
  const editor = createEditor({
    container,
    doc: makeDoc(initial),
    ot: { enabled: ot, getBaseRev: () => rev },
  });
  editor.on('localOps', (ops) => emitted.push(ops));
  return {
    editor,
    emitted,
    ops: () => emitted.flat(),
    text: () => toPlainText(editor.getBlock(B1)!.content),
    type(at, s) {
      const plain = toPlainText(editor.getBlock(B1)!.content);
      const next = plain.slice(0, at) + s + plain.slice(at);
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

/** 跑真正的 markdown 區塊捷徑（`input/input-rules.ts`）。 */
function runShortcut(h: Host, prefix: string): void {
  h.type(0, prefix);
  h.emitted.length = 0; // 只看捷徑那一筆
  h.editor.focusBlock(B1, [...prefix].length);
  const fired = applyBlockInputRule(h.editor, B1, [...prefix].length);
  expect(fired).toBe(true);
}

describe('markdown 捷徑在 OT 模式下的線路形狀（BUG-4）', () => {
  const cases: Array<{ prefix: string; type: string }> = [
    { prefix: '> ', type: 'quote' },
    { prefix: '# ', type: 'heading1' },
    { prefix: '- ', type: 'bulletedList' },
    { prefix: '1. ', type: 'numberedList' },
    { prefix: '[] ', type: 'todo' },
    { prefix: '```', type: 'code' }, // code 的捷徑不需要尾端空白
  ];

  for (const { prefix, type } of cases) {
    it(`\`${prefix}\` → block.update{blockType} + text.delta，content 不走 tx 通道`, () => {
      const h = mount('');
      runShortcut(h, prefix);

      const ops = h.ops();
      // 1) 沒有任何 op 還帶著 content（帶了就會和 OT buffer 撞車）
      for (const op of ops) {
        if (op.type === 'block.update') expect(op.patch.content).toBeUndefined();
      }
      // 2) 型別變更仍然走 tx 通道
      const update = ops.find((o) => o.type === 'block.update');
      expect(update).toBeDefined();
      if (update?.type === 'block.update') expect(update.patch.blockType).toBe(type);
      // 3) 前綴的刪除是一筆 text.delta
      const delta = ops.find((o) => o.type === 'text.delta');
      expect(delta).toBeDefined();
      if (delta?.type === 'text.delta') {
        expect(delta.delta).toEqual({ ops: [{ delete: [...prefix].length }] });
        expect(delta.baseRev).toBe(0);
      }
      // 4) 順序：tx 在前、delta 在後（宿主依序分流，delta 送出前會先把 tx buffer 沖掉）
      expect(ops.findIndex((o) => o.type === 'block.update')).toBeLessThan(
        ops.findIndex((o) => o.type === 'text.delta'),
      );
    });
  }

  it('text.delta 帶的是目前的 baseRev（不是固定 0）', () => {
    const h = mount('', { rev: 7 });
    runShortcut(h, '> ');
    const delta = h.ops().find((o) => o.type === 'text.delta');
    expect(delta?.type === 'text.delta' && delta.baseRev).toBe(7);
  });

  it('關閉 OT 時行為完全不變（仍是一筆帶 content 的 block.update）', () => {
    const h = mount('', { ot: false });
    runShortcut(h, '> ');
    const ops = h.ops();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.type).toBe('block.update');
    if (ops[0]!.type === 'block.update') {
      expect(ops[0]!.patch.blockType).toBe('quote');
      expect(ops[0]!.patch.content).toEqual([]);
    }
  });
});

describe('其他「整段覆寫」路徑', () => {
  it('setBlockType 不改 content → 不會憑空生出 text.delta', () => {
    const h = mount('hello');
    h.editor.setBlockType(B1, 'heading1');
    const ops = h.ops();
    expect(ops.some((o) => o.type === 'text.delta')).toBe(false);
    expect(ops.some((o) => o.type === 'block.update')).toBe(true);
  });

  it('Enter 分割：前半段以 text.delta 送出，block.insert 原樣保留且排在 delta 之後', () => {
    const h = mount('hello');
    h.editor.focusBlock(B1, 3);
    h.editor.dispatch({
      ops: [
        { type: 'block.update', blockId: B1, patch: { content: [{ text: 'hel' }] } },
        {
          type: 'block.insert',
          blockId: 'b2',
          parentId: null,
          afterId: B1,
          blockType: 'paragraph',
          props: {},
          content: [{ text: 'lo' }],
        },
      ],
      kind: 'structural',
    });
    const ops = h.ops();
    expect(ops.map((o) => o.type)).toEqual(['text.delta', 'block.insert']);
    const delta = ops[0]!;
    if (delta.type === 'text.delta') {
      expect(delta.delta).toEqual({ ops: [{ retain: 3 }, { delete: 2 }] });
    }
  });

  it('同一批「先 insert 再改 content」：delta 的基準是剛插入的內容', () => {
    const h = mount('hello');
    h.editor.dispatch({
      ops: [
        {
          type: 'block.insert',
          blockId: 'b3',
          parentId: null,
          afterId: B1,
          blockType: 'paragraph',
          props: {},
          content: [{ text: 'ab' }],
        },
        { type: 'block.update', blockId: 'b3', patch: { content: [{ text: 'abc' }] } },
      ],
      kind: 'structural',
    });
    const ops = h.ops();
    expect(ops.map((o) => o.type)).toEqual(['block.insert', 'text.delta']);
    const delta = ops[1]!;
    if (delta.type === 'text.delta') {
      expect(delta.delta).toEqual({ ops: [{ retain: 2 }, { insert: 'c' }] });
    }
  });

  it('沒有 content 的 op 一律原樣送出（不複製、不重排）', () => {
    const h = mount('hello');
    h.editor.dispatch({
      ops: [{ type: 'block.update', blockId: B1, patch: { props: { color: 'red' } } }],
      kind: 'structural',
    });
    expect(h.ops()).toEqual([
      { type: 'block.update', blockId: B1, patch: { props: { color: 'red' } } },
    ]);
  });
});
