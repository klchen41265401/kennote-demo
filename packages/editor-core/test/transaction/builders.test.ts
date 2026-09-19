import { describe, expect, it } from 'vitest';
import type { EditorDoc } from '../../src/model/types.js';
import { applyOps } from '../../src/transaction/apply.js';
import {
  defaultBuilderContext,
  deleteBlocksOps,
  indentOps,
  insertFragmentOps,
  insertTextOps,
  mergeBackwardOps,
  outdentOps,
  splitBlockOps,
} from '../../src/transaction/builders.js';
import { toPlainText } from '../../src/text/richtext.js';
import { parseMarkdownToBlocks } from '../../src/clipboard/parse-markdown.js';

let counter = 0;
const ctx = { ...defaultBuilderContext, newId: () => `new${++counter}` };

function docOf(): EditorDoc {
  counter = 0;
  return {
    rootIds: ['a', 'b', 'c'],
    blocks: {
      a: { id: 'a', parentId: null, type: 'paragraph', props: {}, content: [{ text: 'Hello world' }], children: [], version: 1 },
      b: { id: 'b', parentId: null, type: 'bulletedList', props: {}, content: [{ text: 'item' }], children: [], version: 1 },
      c: { id: 'c', parentId: null, type: 'paragraph', props: {}, content: [{ text: 'tail' }], children: [], version: 1 },
    },
  };
}

describe('splitBlockOps（Enter）', () => {
  it('從中間分割，後半成為新的兄弟 block', () => {
    const doc = docOf();
    const built = splitBlockOps(doc, 'a', 5, ctx);
    const next = applyOps(doc, built.ops);
    expect(toPlainText(next.blocks.a!.content)).toBe('Hello');
    expect(next.rootIds).toEqual(['a', 'new1', 'b', 'c']);
    expect(toPlainText(next.blocks.new1!.content)).toBe(' world');
    expect(built.selectionAfter).toEqual({ type: 'text', anchor: { blockId: 'new1', offset: 0 }, focus: { blockId: 'new1', offset: 0 } });
  });

  it('清單項分割後仍是清單項（型別延續）', () => {
    const doc = docOf();
    const next = applyOps(doc, splitBlockOps(doc, 'b', 2, ctx).ops);
    expect(next.blocks.new1!.type).toBe('bulletedList');
  });

  it('有子層時，新 block 變成第一個子層（對齊 Notion）', () => {
    const doc = docOf();
    doc.blocks.a!.children = ['c'];
    doc.blocks.c!.parentId = 'a';
    doc.rootIds = ['a', 'b'];
    const next = applyOps(doc, splitBlockOps(doc, 'a', 11, ctx).ops);
    expect(next.blocks.a!.children).toEqual(['new1', 'c']);
  });
});

describe('mergeBackwardOps（行首 Backspace）', () => {
  it('與前一個 block 合併，游標停在接縫處', () => {
    const doc = docOf();
    const built = mergeBackwardOps(doc, 'b', ctx)!;
    const next = applyOps(doc, built.ops);
    expect(toPlainText(next.blocks.a!.content)).toBe('Hello worlditem');
    expect(next.blocks.b).toBeUndefined();
    expect(built.selectionAfter).toEqual({
      type: 'text',
      anchor: { blockId: 'a', offset: 11 },
      focus: { blockId: 'a', offset: 11 },
    });
  });

  it('第一個 block 沒有可合併對象 → null', () => {
    expect(mergeBackwardOps(docOf(), 'a', ctx)).toBeNull();
  });

  it('被合併的 block 的子層會接到目標底下（不會被連帶刪掉）', () => {
    const doc = docOf();
    doc.blocks.b!.children = ['c'];
    doc.blocks.c!.parentId = 'b';
    doc.rootIds = ['a', 'b'];
    const next = applyOps(doc, mergeBackwardOps(doc, 'b', ctx)!.ops);
    expect(next.blocks.c).toBeDefined();
    expect(next.blocks.a!.children).toEqual(['c']);
  });
});

describe('indent / outdent（Tab / Shift+Tab）', () => {
  it('Tab 變成前一個兄弟的子層', () => {
    const doc = docOf();
    const next = applyOps(doc, indentOps(doc, 'b')!.ops);
    expect(next.blocks.a!.children).toEqual(['b']);
    expect(next.rootIds).toEqual(['a', 'c']);
  });

  it('第一個 block 無法縮排', () => {
    expect(indentOps(docOf(), 'a')).toBeNull();
  });

  it('Shift+Tab 升一層並插在原 parent 之後', () => {
    let doc = docOf();
    doc = applyOps(doc, indentOps(doc, 'b')!.ops);
    const next = applyOps(doc, outdentOps(doc, 'b')!.ops);
    expect(next.rootIds).toEqual(['a', 'b', 'c']);
  });

  it('outdent 會把後面的兄弟收成自己的子層（維持清單結構）', () => {
    let doc = docOf();
    doc = applyOps(doc, indentOps(doc, 'b')!.ops);
    doc = applyOps(doc, indentOps(doc, 'c')!.ops); // c 縮進 b 之後成為 a 的第二個子層
    expect(doc.blocks.a!.children).toEqual(['b', 'c']);
    const next = applyOps(doc, outdentOps(doc, 'b')!.ops);
    expect(next.blocks.b!.children).toEqual(['c']);
  });
});

describe('deleteBlocksOps', () => {
  it('批次刪除並把游標放到前一個 block', () => {
    const doc = docOf();
    const built = deleteBlocksOps(doc, ['b', 'c']);
    const next = applyOps(doc, built.ops);
    expect(next.rootIds).toEqual(['a']);
    expect(built.selectionAfter).toEqual({ type: 'text', anchor: { blockId: 'a', offset: 11 }, focus: { blockId: 'a', offset: 11 } });
  });

  it('祖先與子孫同時被選時只刪祖先（不會重複刪）', () => {
    const doc = docOf();
    doc.blocks.a!.children = ['b'];
    doc.blocks.b!.parentId = 'a';
    doc.rootIds = ['a', 'c'];
    const built = deleteBlocksOps(doc, ['a', 'b']);
    expect(built.ops).toHaveLength(1);
    expect(built.ops[0]).toEqual({ type: 'block.delete', blockId: 'a' });
  });
});

describe('insertTextOps', () => {
  it('取代選取範圍', () => {
    const doc = docOf();
    const built = insertTextOps(doc, 'a', 0, 5, 'Bye');
    const next = applyOps(doc, built.ops);
    expect(toPlainText(next.blocks.a!.content)).toBe('Bye world');
    expect(built.selectionAfter).toMatchObject({ focus: { offset: 3 } });
  });
});

describe('insertFragmentOps（貼上）', () => {
  it('單段落片段就地插入，不新增 block', () => {
    const doc = docOf();
    const fragment = parseMarkdownToBlocks('just text', { newId: () => 'f1' });
    const built = insertFragmentOps(doc, 'a', 5, 5, fragment, ctx);
    const next = applyOps(doc, built.ops);
    expect(next.rootIds).toEqual(['a', 'b', 'c']);
    expect(toPlainText(next.blocks.a!.content)).toBe('Hellojust text world');
  });

  it('第一段有自己的型別時不會被併進目前 block（否則標題會變成普通文字）', () => {
    const doc = docOf();
    let n = 0;
    const fragment = parseMarkdownToBlocks('# Title\n\n- one\n- two', { newId: () => `f${++n}` });
    const built = insertFragmentOps(doc, 'a', 11, 11, fragment, ctx);
    const next = applyOps(doc, built.ops);
    expect(toPlainText(next.blocks.a!.content)).toBe('Hello world');
    const inserted = next.rootIds.filter((id) => id.startsWith('new'));
    expect(inserted).toHaveLength(3);
    expect(next.blocks[inserted[0]!]!.type).toBe('heading1');
    expect(next.blocks[inserted[1]!]!.type).toBe('bulletedList');
  });

  it('第一段是普通段落時會併進目前 block（游標處接上文字）', () => {
    const doc = docOf();
    let n = 0;
    const fragment = parseMarkdownToBlocks('plain\n\n- one', { newId: () => `f${++n}` });
    const next = applyOps(doc, insertFragmentOps(doc, 'a', 11, 11, fragment, ctx).ops);
    expect(toPlainText(next.blocks.a!.content)).toBe('Hello worldplain');
    const inserted = next.rootIds.filter((id) => id.startsWith('new'));
    expect(inserted).toHaveLength(1);
    expect(next.blocks[inserted[0]!]!.type).toBe('bulletedList');
  });

  it('空 block 貼上時會採用片段的型別', () => {
    const doc = docOf();
    doc.blocks.a!.content = [];
    const fragment = parseMarkdownToBlocks('## Heading', { newId: () => 'f1' });
    const next = applyOps(doc, insertFragmentOps(doc, 'a', 0, 0, fragment, ctx).ops);
    expect(next.blocks.a!.type).toBe('heading2');
    expect(toPlainText(next.blocks.a!.content)).toBe('Heading');
  });
});
