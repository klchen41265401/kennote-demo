/**
 * @vitest-environment jsdom
 *
 * 剪貼簿管線：copy/cut 三格式輸出、paste 四層優先序。
 * jsdom 沒有 DataTransfer，所以用一個最小的假物件（我們的程式只用到 getData/setData/files）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEditor, KENNOTE_MIME, type Editor } from '../../src/index.js';
import type { EditorDoc } from '../../src/model/types.js';
import { toPlainText } from '../../src/text/richtext.js';
import { BLOCK_ID_ATTR } from '../../src/selection/dom-mapper.js';

class FakeDataTransfer {
  private data = new Map<string, string>();
  files: File[] = [];
  setData(mime: string, value: string): void {
    this.data.set(mime, value);
  }
  getData(mime: string): string {
    return this.data.get(mime) ?? '';
  }
  has(mime: string): boolean {
    return this.data.has(mime);
  }
}

let container: HTMLElement;
let editor: Editor;
let ids = 0;

function makeDoc(texts: string[]): EditorDoc {
  const blocks: EditorDoc['blocks'] = {};
  const rootIds: string[] = [];
  texts.forEach((text, i) => {
    const id = `b${i + 1}`;
    blocks[id] = { id, parentId: null, type: 'paragraph', props: {}, content: text ? [{ text }] : [], children: [], version: 1 };
    rootIds.push(id);
  });
  return { rootIds, blocks };
}

function create(texts: string[]): Editor {
  ids = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  return createEditor({ container, doc: makeDoc(texts), newId: () => `n${++ids}`, now: () => 0 });
}

function fireClipboard(type: 'copy' | 'cut' | 'paste', dt: FakeDataTransfer): void {
  const sel = editor.getSelection();
  const blockId = sel.type === 'text' ? sel.focus.blockId : sel.type === 'block' ? sel.blockIds[0]! : editor.getDoc().rootIds[0]!;
  const el = container.querySelector<HTMLElement>(`[${BLOCK_ID_ATTR}="${blockId}"]`) ?? container;
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: dt });
  el.dispatchEvent(event);
}

function textOf(blockId: string): string {
  return toPlainText(editor.getBlock(blockId)?.content ?? []);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  editor?.destroy();
});

describe('複製', () => {
  it('文字選取會寫入三種格式', () => {
    editor = create(['Hello world']);
    editor.setSelection({ type: 'text', anchor: { blockId: 'b1', offset: 0 }, focus: { blockId: 'b1', offset: 5 } });
    const dt = new FakeDataTransfer();
    fireClipboard('copy', dt);
    expect(dt.getData('text/plain')).toBe('Hello');
    expect(dt.getData('text/html')).toContain('Hello');
    expect(JSON.parse(dt.getData(KENNOTE_MIME)).rootIds).toHaveLength(1);
  });

  it('block selection 會複製整批 block（含型別）', () => {
    editor = create(['one', 'two']);
    editor.setBlockType('b2', 'heading1');
    editor.setSelection({ type: 'block', blockIds: ['b1', 'b2'], anchorId: 'b1', focusId: 'b2' });
    const dt = new FakeDataTransfer();
    fireClipboard('copy', dt);
    expect(dt.getData('text/plain')).toBe('one\n# two');
    expect(dt.getData('text/html')).toContain('<h1>two</h1>');
  });

  it('格式會轉成語義化 HTML 與 Markdown', () => {
    editor = create(['bold text']);
    editor.setSelection({ type: 'text', anchor: { blockId: 'b1', offset: 0 }, focus: { blockId: 'b1', offset: 4 } });
    editor.toggleMark({ t: 'b' });
    editor.setSelection({ type: 'text', anchor: { blockId: 'b1', offset: 0 }, focus: { blockId: 'b1', offset: 9 } });
    const dt = new FakeDataTransfer();
    fireClipboard('copy', dt);
    expect(dt.getData('text/html')).toContain('<strong>bold</strong>');
    expect(dt.getData('text/plain')).toBe('**bold** text');
  });
});

describe('剪下', () => {
  it('剪下文字：寫剪貼簿後刪除，且可 undo', () => {
    editor = create(['Hello world']);
    editor.setSelection({ type: 'text', anchor: { blockId: 'b1', offset: 0 }, focus: { blockId: 'b1', offset: 6 } });
    const dt = new FakeDataTransfer();
    fireClipboard('cut', dt);
    expect(dt.getData('text/plain')).toBe('Hello ');
    expect(textOf('b1')).toBe('world');
    editor.undo();
    expect(textOf('b1')).toBe('Hello world');
  });

  it('剪下整批 block', () => {
    editor = create(['a', 'b', 'c']);
    editor.setSelection({ type: 'block', blockIds: ['b1', 'b2'], anchorId: 'b1', focusId: 'b2' });
    fireClipboard('cut', new FakeDataTransfer());
    expect(editor.getDoc().rootIds).toEqual(['b3']);
  });
});

describe('貼上的四層優先序', () => {
  it('1. 自家格式優先，且會換新 id 避免撞 id', () => {
    editor = create(['target']);
    const source = {
      rootIds: ['x1'],
      blocks: {
        x1: { id: 'x1', parentId: null, type: 'heading2', props: {}, content: [{ text: 'from kennote' }], children: [], version: 1 },
      },
    };
    const dt = new FakeDataTransfer();
    dt.setData(KENNOTE_MIME, JSON.stringify(source));
    dt.setData('text/html', '<p>should be ignored</p>');
    dt.setData('text/plain', 'should be ignored');
    editor.focusBlock('b1', 6);
    fireClipboard('paste', dt);
    const ids2 = editor.getDoc().rootIds;
    expect(ids2).not.toContain('x1');
    const pasted = ids2.map((id) => editor.getBlock(id)!).find((b) => toPlainText(b.content).includes('from kennote'));
    expect(pasted).toBeDefined();
    expect(pasted!.type).toBe('heading2');
  });

  it('2. HTML 次之', () => {
    editor = create(['']);
    const dt = new FakeDataTransfer();
    dt.setData('text/html', '<h1>Title</h1><ul><li>item</li></ul>');
    dt.setData('text/plain', 'Title\nitem');
    editor.focusBlock('b1', 0);
    fireClipboard('paste', dt);
    const types = editor.getDoc().rootIds.map((id) => editor.getBlock(id)!.type);
    expect(types).toEqual(['heading1', 'bulletedList']);
  });

  it('3. 純文字且看起來像 Markdown → 走 Markdown 解析', () => {
    editor = create(['']);
    const dt = new FakeDataTransfer();
    dt.setData('text/plain', '# Heading\n- a\n- b');
    editor.focusBlock('b1', 0);
    fireClipboard('paste', dt);
    const types = editor.getDoc().rootIds.map((id) => editor.getBlock(id)!.type);
    expect(types).toEqual(['heading1', 'bulletedList', 'bulletedList']);
  });

  it('4. 純文字 → 按行分段', () => {
    editor = create(['']);
    const dt = new FakeDataTransfer();
    dt.setData('text/plain', 'line one\nline two');
    editor.focusBlock('b1', 0);
    fireClipboard('paste', dt);
    expect(editor.getDoc().rootIds).toHaveLength(2);
    expect(textOf(editor.getDoc().rootIds[0]!)).toBe('line one');
  });

  it('單行純文字貼在文字中間 → 就地插入，不建立新 block', () => {
    editor = create(['abcd']);
    const dt = new FakeDataTransfer();
    dt.setData('text/plain', 'XY');
    editor.focusBlock('b1', 2);
    fireClipboard('paste', dt);
    expect(editor.getDoc().rootIds).toHaveLength(1);
    expect(textOf('b1')).toBe('abXYcd');
  });

  it('貼上可以整批 undo', () => {
    editor = create(['']);
    const dt = new FakeDataTransfer();
    dt.setData('text/plain', '# A\n# B');
    editor.focusBlock('b1', 0);
    fireClipboard('paste', dt);
    expect(editor.getDoc().rootIds.length).toBeGreaterThan(1);
    editor.undo();
    expect(editor.getDoc().rootIds).toHaveLength(1);
    expect(textOf('b1')).toBe('');
  });

  it('站內 copy → paste 完整還原（含巢狀與型別）', () => {
    editor = create(['parent', 'child', 'other']);
    editor.setBlockType('b1', 'toggle');
    editor.moveBlock('b2', 'b1', null);
    editor.setSelection({ type: 'block', blockIds: ['b1'], anchorId: 'b1', focusId: 'b1' });
    const dt = new FakeDataTransfer();
    fireClipboard('copy', dt);

    editor.focusBlock('b3', 5);
    fireClipboard('paste', dt);

    const roots = editor.getDoc().rootIds.map((id) => editor.getBlock(id)!);
    const toggles = roots.filter((b) => b.type === 'toggle');
    // 原本那個 + 貼上的那個（貼上會換新 id，不會蓋掉來源）
    expect(toggles).toHaveLength(2);
    const pasted = toggles.find((b) => b.id !== 'b1')!;
    expect(pasted.children).toHaveLength(1);
    expect(toPlainText(editor.getBlock(pasted.children[0]!)!.content)).toBe('child');
  });
});
