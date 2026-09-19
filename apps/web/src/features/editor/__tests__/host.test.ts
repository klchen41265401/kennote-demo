import { describe, expect, it } from 'vitest';
import { createEditor } from '@kennote/editor-core';
import type { PageSnapshot } from '@kennote/shared-types';
import { snapshotToDoc } from '../useEditorHost';
import { createHostRegistry } from '../blocks/hostRegistry';
import { duplicateBlockOps, isDescendantOf, moveOpFor } from '../lib/model-helpers';
import { handleSelectAll } from '../keyboard/hostKeymap';
import { buildColumnOps } from '../dnd/useBlockDrag';

function snapshot(partial: Partial<PageSnapshot> = {}): PageSnapshot {
  const now = new Date().toISOString();
  const block = (id: string, parentId: string | null, children: string[] = []) => ({
    value: {
      id,
      pageId: 'p1',
      parentId,
      type: 'paragraph' as const,
      props: {},
      content: [{ text: id }],
      children,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
    },
    role: 'editor' as const,
  });
  return {
    pageId: 'p1',
    seq: 3,
    rootBlockIds: ['a', 'b'],
    recordMap: {
      page: {},
      block: { a: block('a', null, ['a1']), a1: block('a1', 'a'), b: block('b', null) },
      user: {},
    },
    ...partial,
  } as PageSnapshot;
}

describe('snapshotToDoc', () => {
  it('把 record_map 轉成 EditorDoc，保留父子順序', () => {
    const doc = snapshotToDoc(snapshot());
    expect(doc.rootIds).toEqual(['a', 'b']);
    expect(doc.blocks.a?.children).toEqual(['a1']);
    expect(doc.blocks.a1?.parentId).toBe('a');
    expect(Object.keys(doc.blocks)).toHaveLength(3);
  });

  it('後端資料不一致時不會整頁炸掉：丟掉指向不存在 block 的 id', () => {
    const snap = snapshot();
    snap.rootBlockIds = ['a', 'ghost', 'b'];
    (snap.recordMap.block.a as { value: { children: string[] } }).value.children = ['a1', 'ghost2'];
    const doc = snapshotToDoc(snap);
    expect(doc.rootIds).toEqual(['a', 'b']);
    expect(doc.blocks.a?.children).toEqual(['a1']);
  });

  it('空頁面得到空 doc（宿主會補一個段落）', () => {
    const doc = snapshotToDoc(snapshot({ rootBlockIds: [], recordMap: { page: {}, block: {}, user: {} } }));
    expect(doc.rootIds).toEqual([]);
    expect(doc.blocks).toEqual({});
  });
});

function makeEditor() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let n = 0;
  const editor = createEditor({
    container,
    doc: snapshotToDoc(snapshot()),
    blockRegistry: createHostRegistry(),
    newId: () => `new-${++n}`,
  });
  return { editor, container };
}

describe('model helpers（全部落成 Operation，不偷改 doc）', () => {
  it('duplicateBlockOps 深拷貝整棵子樹並給新 id', () => {
    const { editor } = makeEditor();
    const { ops, newRootId } = duplicateBlockOps(editor.getDoc(), 'a', editor.newId);
    expect(ops).toHaveLength(2); // a + a1
    expect(ops.every((o) => o.type === 'block.insert')).toBe(true);
    expect(newRootId).not.toBe('a');
    expect(editor.dispatch({ ops, kind: 'structural' })).toBe(true);
    expect(editor.getDoc().rootIds).toHaveLength(3);
    editor.destroy();
  });

  it('moveOpFor 算出 parentId / afterId', () => {
    const { editor } = makeEditor();
    const doc = editor.getDoc();
    expect(moveOpFor(doc, 'b', { id: 'a', position: 'after' })).toEqual({ parentId: null, afterId: 'a' });
    expect(moveOpFor(doc, 'b', { id: 'a', position: 'before' })).toEqual({ parentId: null, afterId: null });
    expect(moveOpFor(doc, 'b', { id: 'a', position: 'child' })).toEqual({ parentId: 'a', afterId: 'a1' });
    expect(moveOpFor(doc, 'b', { id: 'ghost', position: 'after' })).toBeNull();
    editor.destroy();
  });

  it('isDescendantOf 擋掉「拖到自己的子孫」', () => {
    const { editor } = makeEditor();
    const doc = editor.getDoc();
    expect(isDescendantOf(doc, 'a1', 'a')).toBe(true);
    expect(isDescendantOf(doc, 'a', 'a1')).toBe(false);
    expect(isDescendantOf(doc, 'b', 'a')).toBe(false);
    editor.destroy();
  });

  it('buildColumnOps 產生 columnList + 兩欄，再把兩個 block 搬進去', () => {
    const { editor } = makeEditor();
    const ops = buildColumnOps(editor, editor.getDoc(), ['b'], 'a', 'right');
    expect(ops.filter((o) => o.type === 'block.insert')).toHaveLength(3);
    expect(ops.filter((o) => o.type === 'block.move')).toHaveLength(2);
    expect(editor.dispatch({ ops, kind: 'structural' })).toBe(true);

    const doc = editor.getDoc();
    const listId = doc.rootIds.find((id) => doc.blocks[id]?.type === 'columnList');
    expect(listId).toBeDefined();
    const columns = doc.blocks[listId as string]?.children ?? [];
    expect(columns).toHaveLength(2);
    expect(doc.blocks[columns[0] as string]?.children).toEqual(['a']);
    expect(doc.blocks[columns[1] as string]?.children).toEqual(['b']);
    editor.destroy();
  });
});

describe('Cmd/Ctrl+A 三段式（02 §4.1.3）', () => {
  it('第一次選整段文字、第二次同層、第三次整頁', () => {
    const { editor } = makeEditor();
    editor.focusBlock('a1', 0);

    expect(handleSelectAll(editor, 0)).toBe(true);
    let sel = editor.getSelection();
    expect(sel.type).toBe('text');
    if (sel.type === 'text') {
      expect(sel.anchor.offset).toBe(0);
      expect(sel.focus.offset).toBe(2); // 'a1'
    }

    expect(handleSelectAll(editor, 1)).toBe(true);
    sel = editor.getSelection();
    expect(sel.type).toBe('block');
    if (sel.type === 'block') expect(sel.blockIds).toEqual(['a1']);

    expect(handleSelectAll(editor, 2)).toBe(true);
    sel = editor.getSelection();
    expect(sel.type).toBe('block');
    if (sel.type === 'block') expect(sel.blockIds).toEqual(['a', 'b']);
    editor.destroy();
  });

  it('沒有選取時不處理', () => {
    const { editor } = makeEditor();
    expect(handleSelectAll(editor, 0)).toBe(false);
    editor.destroy();
  });
});

describe('editor-core 整合（宿主 registry 不能破壞既有行為）', () => {
  it('localOps 會把使用者變更廣播出來（transport 的入口）', () => {
    const { editor } = makeEditor();
    const batches: number[] = [];
    editor.on('localOps', (ops) => batches.push(ops.length));
    editor.setBlockType('a', 'heading1');
    expect(batches.length).toBeGreaterThan(0);
    expect(editor.getBlock('a')?.type).toBe('heading1');
    editor.destroy();
  });

  it('applyRemote 不會再 emit localOps（rollback 走這條路才不會回送伺服器）', () => {
    const { editor } = makeEditor();
    let emitted = 0;
    editor.on('localOps', () => (emitted += 1));
    editor.applyRemote([{ type: 'block.update', blockId: 'b', patch: { content: [{ text: 'remote' }] } }]);
    expect(emitted).toBe(0);
    editor.destroy();
  });

  it('不合法的 operation 整批不套用（原子性）', () => {
    const { editor } = makeEditor();
    const before = editor.getDoc();
    const ok = editor.dispatch({
      ops: [
        { type: 'block.update', blockId: 'a', patch: { content: [{ text: 'changed' }] } },
        { type: 'block.update', blockId: 'does-not-exist', patch: { content: [] } },
      ],
      kind: 'structural',
    });
    expect(ok).toBe(false);
    expect(editor.getDoc()).toBe(before);
    editor.destroy();
  });

  it('image block 在 DOM 上只是一個空的 React 掛載容器', () => {
    const { editor } = makeEditor();
    editor.setBlockType('b', 'image');
    const el = editor.view.getBlockEl('b');
    const main = el?.firstElementChild as HTMLElement;
    expect(main.getAttribute('data-kn-react-block')).toBe('image');
    expect(main.querySelector('[data-block-content]')).toBeNull();
    editor.destroy();
  });
});
