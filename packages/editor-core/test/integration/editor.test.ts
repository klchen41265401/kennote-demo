/**
 * @vitest-environment jsdom
 *
 * 端到端（Node + jsdom）的編輯器行為測試：
 * 模擬 beforeinput / composition 事件序列，驗證 M2-A 的驗收標準。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '../../src/index.js';
import type { EditorDoc } from '../../src/model/types.js';
import { toPlainText } from '../../src/text/richtext.js';
import { BLOCK_CONTENT_ATTR, BLOCK_ID_ATTR } from '../../src/selection/dom-mapper.js';

const FAMILY = '👨‍👩‍👧‍👦';

let container: HTMLElement;
let editor: Editor;
let clock = 0;
let ids = 0;

function makeDoc(texts: string[]): EditorDoc {
  const blocks: EditorDoc['blocks'] = {};
  const rootIds: string[] = [];
  texts.forEach((text, i) => {
    const id = `b${i + 1}`;
    blocks[id] = {
      id,
      parentId: null,
      type: 'paragraph',
      props: {},
      content: text ? [{ text }] : [],
      children: [],
      version: 1,
    };
    rootIds.push(id);
  });
  return { rootIds, blocks };
}

function create(texts: string[] = ['']): Editor {
  clock = 0;
  ids = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  return createEditor({
    container,
    doc: makeDoc(texts),
    newId: () => `n${++ids}`,
    now: () => clock,
  });
}

function contentElOf(blockId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[${BLOCK_ID_ATTR}="${blockId}"] [${BLOCK_CONTENT_ATTR}]`);
  if (!el) throw new Error(`no content element for ${blockId}`);
  return el;
}

function beforeInput(inputType: string, data?: string): boolean {
  const sel = editor.getSelection();
  const blockId = sel.type === 'text' ? sel.focus.blockId : editor.getDoc().rootIds[0]!;
  const el = contentElOf(blockId);
  const init: InputEventInit = { inputType, bubbles: true, cancelable: true };
  if (data !== undefined) init.data = data;
  return el.dispatchEvent(new InputEvent('beforeinput', init));
}

function keyDown(key: string, init: KeyboardEventInit = {}): void {
  const sel = editor.getSelection();
  const blockId = sel.type === 'text' ? sel.focus.blockId : editor.getDoc().rootIds[0]!;
  const el = container.querySelector<HTMLElement>(`[${BLOCK_ID_ATTR}="${blockId}"]`) ?? container;
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

function type(text: string, msPerChar = 30): void {
  for (const ch of text) {
    clock += msPerChar;
    beforeInput('insertText', ch);
  }
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

describe('基本輸入（beforeinput 管線）', () => {
  it('insertText 會改 model 並同步 DOM', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('Hello');
    expect(textOf('b1')).toBe('Hello');
    expect(contentElOf('b1').textContent).toBe('Hello');
    expect(editor.getSelection()).toMatchObject({ focus: { blockId: 'b1', offset: 5 } });
  });

  it('beforeinput 一律 preventDefault（瀏覽器不得自己改 DOM）', () => {
    editor = create(['abc']);
    editor.focusBlock('b1', 3);
    expect(beforeInput('insertText', 'd')).toBe(false); // preventDefault → dispatchEvent 回傳 false
  });

  it('CJK 與 emoji 都能正確插入', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('中文😀');
    expect(textOf('b1')).toBe('中文😀');
    expect(editor.getSelection()).toMatchObject({ focus: { offset: 3 } });
  });

  it('選取範圍會被輸入的字取代', () => {
    editor = create(['Hello world']);
    editor.setSelection({ type: 'text', anchor: { blockId: 'b1', offset: 0 }, focus: { blockId: 'b1', offset: 5 } });
    beforeInput('insertText', 'Bye');
    expect(textOf('b1')).toBe('Bye world');
  });

  it('未知的 inputType 會被擋下並回報 reconcile（開發期看得見漏洞）', () => {
    editor = create(['abc']);
    editor.focusBlock('b1', 1);
    const spy = vi.fn();
    editor.on('reconcile', spy);
    beforeInput('insertOrderedList');
    expect(spy).toHaveBeenCalled();
  });
});

describe('刪除', () => {
  it('Backspace 一次刪一個 grapheme：家庭 emoji 整組消失', () => {
    editor = create([`a${FAMILY}`]);
    editor.focusBlock('b1', 8); // 1 + 7 code points
    beforeInput('deleteContentBackward');
    expect(textOf('b1')).toBe('a');
  });

  it('Backspace 刪 surrogate pair 不會留下半個字', () => {
    editor = create(['a😀']);
    editor.focusBlock('b1', 2);
    beforeInput('deleteContentBackward');
    expect(textOf('b1')).toBe('a');
  });

  it('Delete 往後刪', () => {
    editor = create(['abc']);
    editor.focusBlock('b1', 1);
    beforeInput('deleteContentForward');
    expect(textOf('b1')).toBe('ac');
  });

  it('deleteWordBackward 刪掉整個詞', () => {
    editor = create(['hello world']);
    editor.focusBlock('b1', 11);
    beforeInput('deleteWordBackward');
    expect(textOf('b1')).toBe('hello ');
  });

  it('行首 Backspace 與前一個 block 合併，游標停在接縫處', () => {
    editor = create(['abc', 'def']);
    editor.focusBlock('b2', 0);
    beforeInput('deleteContentBackward');
    expect(textOf('b1')).toBe('abcdef');
    expect(editor.getBlock('b2')).toBeUndefined();
    expect(editor.getSelection()).toMatchObject({ focus: { blockId: 'b1', offset: 3 } });
  });

  it('非段落型的行首 Backspace 先降級為段落，再按才合併', () => {
    editor = create(['abc', 'item']);
    editor.setBlockType('b2', 'bulletedList');
    editor.focusBlock('b2', 0);
    beforeInput('deleteContentBackward');
    expect(editor.getBlock('b2')!.type).toBe('paragraph');
    beforeInput('deleteContentBackward');
    expect(textOf('b1')).toBe('abcitem');
  });
});

describe('Enter / 分割與跳出', () => {
  it('段落中間 Enter 會分割成兩個 block', () => {
    editor = create(['Hello world']);
    editor.focusBlock('b1', 5);
    beforeInput('insertParagraph');
    expect(textOf('b1')).toBe('Hello');
    const newId = editor.getDoc().rootIds[1]!;
    expect(textOf(newId)).toBe(' world');
    expect(editor.getSelection()).toMatchObject({ focus: { blockId: newId, offset: 0 } });
  });

  it('空的清單項按 Enter 會跳出清單（轉回段落）', () => {
    editor = create(['']);
    editor.setBlockType('b1', 'bulletedList');
    editor.focusBlock('b1', 0);
    beforeInput('insertParagraph');
    expect(editor.getBlock('b1')!.type).toBe('paragraph');
    expect(editor.getDoc().rootIds).toHaveLength(1);
  });

  it('Shift+Enter 是軟換行，不建立新 block', () => {
    editor = create(['ab']);
    editor.focusBlock('b1', 1);
    beforeInput('insertLineBreak');
    expect(textOf('b1')).toBe('a\nb');
    expect(editor.getDoc().rootIds).toHaveLength(1);
  });

  it('code block 的 Enter 是軟換行', () => {
    editor = create(['x']);
    editor.setBlockType('b1', 'code');
    editor.focusBlock('b1', 1);
    beforeInput('insertParagraph');
    expect(textOf('b1')).toBe('x\n');
    expect(editor.getDoc().rootIds).toHaveLength(1);
  });
});

describe('Undo / Redo（假時鐘）', () => {
  it('打 100 個字，Ctrl+Z 一次全部還原', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    for (let i = 0; i < 100; i++) {
      clock += 30;
      beforeInput('insertText', 'a');
    }
    expect(textOf('b1')).toHaveLength(100);
    editor.undo();
    expect(textOf('b1')).toBe('');
  });

  it('停頓 1 秒後再打，Ctrl+Z 只還原第二段', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('first');
    clock += 1500; // 停頓
    type('second');
    expect(textOf('b1')).toBe('firstsecond');
    editor.undo();
    expect(textOf('b1')).toBe('first');
    editor.undo();
    expect(textOf('b1')).toBe('');
  });

  it('undo 會還原選取位置', () => {
    editor = create(['abc']);
    editor.focusBlock('b1', 3);
    type('XY');
    editor.undo();
    expect(editor.getSelection()).toMatchObject({ focus: { blockId: 'b1', offset: 3 } });
  });

  it('redo 還原回來', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('abc');
    editor.undo();
    expect(textOf('b1')).toBe('');
    editor.redo();
    expect(textOf('b1')).toBe('abc');
  });

  it('historyUndo inputType 走自己的 undo stack', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('abc');
    beforeInput('historyUndo');
    expect(textOf('b1')).toBe('');
  });

  it('結構操作（分割 block）可以 undo', () => {
    editor = create(['Hello world']);
    editor.focusBlock('b1', 5);
    beforeInput('insertParagraph');
    expect(editor.getDoc().rootIds).toHaveLength(2);
    editor.undo();
    expect(editor.getDoc().rootIds).toHaveLength(1);
    expect(textOf('b1')).toBe('Hello world');
  });
});

describe('格式', () => {
  it('選取後套粗體，再套一次取消（toggle 語義）', () => {
    editor = create(['Hello world']);
    editor.setSelection({ type: 'text', anchor: { blockId: 'b1', offset: 0 }, focus: { blockId: 'b1', offset: 5 } });
    editor.toggleMark({ t: 'b' });
    expect(editor.getBlock('b1')!.content[0]!.marks).toEqual([{ t: 'b' }]);
    expect(editor.getActiveMarks()).toEqual([{ t: 'b' }]);
    editor.toggleMark({ t: 'b' });
    expect(editor.getBlock('b1')!.content).toEqual([{ text: 'Hello world' }]);
  });

  it('formatBold inputType 等價於 Ctrl+B', () => {
    editor = create(['abc']);
    editor.setSelection({ type: 'text', anchor: { blockId: 'b1', offset: 0 }, focus: { blockId: 'b1', offset: 3 } });
    beforeInput('formatBold');
    expect(editor.getBlock('b1')!.content[0]!.marks).toEqual([{ t: 'b' }]);
  });

  it('跨越既有粗體選取後套斜體，span 數最小化', () => {
    editor = create(['']);
    editor.dispatch({
      ops: [
        {
          type: 'block.update',
          blockId: 'b1',
          patch: { content: [{ text: 'aa' }, { text: 'bb', marks: [{ t: 'b' }] }, { text: 'cc' }] },
        },
      ],
    });
    editor.setSelection({ type: 'text', anchor: { blockId: 'b1', offset: 0 }, focus: { blockId: 'b1', offset: 6 } });
    editor.toggleMark({ t: 'i' });
    expect(editor.getBlock('b1')!.content).toHaveLength(3);
  });

  it('套完格式後選取範圍保持不變（可以連按 Cmd+B Cmd+I）', () => {
    editor = create(['abcdef']);
    editor.setSelection({ type: 'text', anchor: { blockId: 'b1', offset: 1 }, focus: { blockId: 'b1', offset: 4 } });
    editor.toggleMark({ t: 'b' });
    expect(editor.getSelection()).toMatchObject({ anchor: { offset: 1 }, focus: { offset: 4 } });
  });
});

describe('IME（注音／拼音）', () => {
  /** 模擬瀏覽器在組字期間直接改 DOM。 */
  function browserWrites(blockId: string, text: string): void {
    const el = contentElOf(blockId);
    const span = el.querySelector('[data-idx]');
    if (span) span.textContent = text;
    else el.textContent = text;
  }

  it('組字期間不 emit localOps，也不動 model', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    const localOps = vi.fn();
    editor.on('localOps', localOps);

    contentElOf('b1').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(editor.isComposing).toBe(true);
    contentElOf('b1').dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'ㄓ' }));
    browserWrites('b1', 'ㄓ');
    expect(textOf('b1')).toBe('');
    expect(localOps).not.toHaveBeenCalled();
  });

  it('compositionend 從 DOM 讀回內容並對帳，不吞字', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    const contentEl = contentElOf('b1');

    contentEl.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    browserWrites('b1', '中文');
    contentEl.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
    editor.finishCompositionForTest();

    expect(editor.isComposing).toBe(false);
    expect(textOf('b1')).toBe('中文');
    expect(editor.getSelection()).toMatchObject({ focus: { blockId: 'b1', offset: 2 } });
  });

  it('在既有文字中間組字，結果接在正確位置', () => {
    editor = create(['ab']);
    editor.focusBlock('b1', 1);
    const contentEl = contentElOf('b1');
    contentEl.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    browserWrites('b1', 'a中b');
    contentEl.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));
    editor.finishCompositionForTest();
    expect(textOf('b1')).toBe('a中b');
  });

  it('組字期間的 view.freeze 讓 block 不被重繪', () => {
    editor = create(['abc']);
    editor.focusBlock('b1', 3);
    contentElOf('b1').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(editor.view.isFrozen('b1')).toBe(true);
    editor.finishCompositionForTest();
    expect(editor.view.isFrozen('b1')).toBe(false);
  });

  it('組字期間收到的遠端 ops 會排隊，compositionend 之後才套用', () => {
    editor = create(['abc', 'other']);
    editor.focusBlock('b1', 3);
    const contentEl = contentElOf('b1');

    contentEl.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const applied = editor.applyRemote([{ type: 'block.update', blockId: 'b2', patch: { content: [{ text: 'remote!' }] } }]);
    expect(applied).toBe(false);
    expect(editor.pendingRemoteOps).toBe(1);
    expect(textOf('b2')).toBe('other'); // 還沒套用

    browserWrites('b1', 'abc中');
    contentEl.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));
    editor.finishCompositionForTest();

    expect(textOf('b1')).toBe('abc中'); // 自己的字沒被吞掉
    expect(textOf('b2')).toBe('remote!'); // 遠端變更補上了
    expect(editor.pendingRemoteOps).toBe(0);
  });

  it('組字期間 selection 變動不會被處理（候選字視窗不會錯位）', () => {
    editor = create(['abc']);
    editor.focusBlock('b1', 1);
    contentElOf('b1').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const before = editor.getSelection();
    document.dispatchEvent(new Event('selectionchange'));
    expect(editor.getSelection()).toEqual(before);
    editor.finishCompositionForTest();
  });

  it('compositionChange 事件通知宿主', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    const spy = vi.fn();
    editor.on('compositionChange', spy);
    contentElOf('b1').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    editor.finishCompositionForTest();
    expect(spy).toHaveBeenNthCalledWith(1, true);
    expect(spy).toHaveBeenNthCalledWith(2, false);
  });
});

describe('Markdown 輸入捷徑', () => {
  it('# + 空白 → 標題 1', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('# ');
    expect(editor.getBlock('b1')!.type).toBe('heading1');
    expect(textOf('b1')).toBe('');
  });

  it('### + 空白 → 標題 3', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('### ');
    expect(editor.getBlock('b1')!.type).toBe('heading3');
  });

  it('- / * + 空白 → 清單', () => {
    editor = create(['', '']);
    editor.focusBlock('b1', 0);
    type('- ');
    expect(editor.getBlock('b1')!.type).toBe('bulletedList');
    editor.focusBlock('b2', 0);
    type('* ');
    expect(editor.getBlock('b2')!.type).toBe('bulletedList');
  });

  it('1. + 空白 → 編號清單', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('1. ');
    expect(editor.getBlock('b1')!.type).toBe('numberedList');
  });

  it('[] 與 [x] → 待辦（含勾選狀態）', () => {
    editor = create(['', '']);
    editor.focusBlock('b1', 0);
    type('[] ');
    expect(editor.getBlock('b1')!.type).toBe('todo');
    expect(editor.getBlock('b1')!.props.checked).toBe(false);
    editor.focusBlock('b2', 0);
    type('[x] ');
    expect(editor.getBlock('b2')!.type).toBe('todo');
    expect(editor.getBlock('b2')!.props.checked).toBe(true);
  });

  it('> + 空白 → 引言；>> + 空白 → 摺疊', () => {
    editor = create(['', '']);
    editor.focusBlock('b1', 0);
    type('> ');
    expect(editor.getBlock('b1')!.type).toBe('quote');
    editor.focusBlock('b2', 0);
    type('>> ');
    expect(editor.getBlock('b2')!.type).toBe('toggle');
  });

  it('``` → 程式碼區塊（可帶語言）', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('```');
    expect(editor.getBlock('b1')!.type).toBe('code');
  });

  it('全形前綴也支援（中文輸入法常打出全形符號）', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('＃ ');
    expect(editor.getBlock('b1')!.type).toBe('heading1');
  });

  it('block 中間輸入 "# " 不會轉換', () => {
    editor = create(['abc']);
    editor.focusBlock('b1', 3);
    type('# ');
    expect(editor.getBlock('b1')!.type).toBe('paragraph');
    expect(textOf('b1')).toBe('abc# ');
  });

  it('轉換後立刻按 Backspace 會還原成原始文字', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('# ');
    expect(editor.getBlock('b1')!.type).toBe('heading1');
    beforeInput('deleteContentBackward');
    expect(editor.getBlock('b1')!.type).toBe('paragraph');
    expect(textOf('b1')).toBe('# ');
  });

  it('行內：**粗體** 即時轉換', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('**bold**');
    expect(editor.getBlock('b1')!.content).toEqual([{ text: 'bold', marks: [{ t: 'b' }] }]);
  });

  it('行內：`程式碼` 即時轉換', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('`x`');
    expect(editor.getBlock('b1')!.content).toEqual([{ text: 'x', marks: [{ t: 'code' }] }]);
  });

  it('行內：~~刪除線~~ 即時轉換', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('~~s~~');
    expect(editor.getBlock('b1')!.content).toEqual([{ text: 's', marks: [{ t: 's' }] }]);
  });

  it('IME 組字期間不套用轉換', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    const el = contentElOf('b1');
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.textContent = '# ';
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '# ' }));
    editor.finishCompositionForTest();
    expect(editor.getBlock('b1')!.type).toBe('paragraph');
  });
});

describe('鍵盤導航與 block selection', () => {
  it('Tab / Shift+Tab 縮排與取消縮排', () => {
    editor = create(['a', 'b']);
    editor.focusBlock('b2', 0);
    keyDown('Tab');
    expect(editor.getBlock('b1')!.children).toEqual(['b2']);
    keyDown('Tab', { shiftKey: true });
    expect(editor.getDoc().rootIds).toEqual(['b1', 'b2']);
  });

  it('← 在 offset 0 移到前一個 block 末尾', () => {
    editor = create(['abc', 'def']);
    editor.focusBlock('b2', 0);
    keyDown('ArrowLeft');
    expect(editor.getSelection()).toMatchObject({ focus: { blockId: 'b1', offset: 3 } });
  });

  it('→ 在結尾移到下一個 block 開頭', () => {
    editor = create(['abc', 'def']);
    editor.focusBlock('b1', 3);
    keyDown('ArrowRight');
    expect(editor.getSelection()).toMatchObject({ focus: { blockId: 'b2', offset: 0 } });
  });

  it('↑↓ 跨 block 移動', () => {
    editor = create(['abc', 'def']);
    editor.focusBlock('b2', 1);
    keyDown('ArrowUp');
    expect(editor.getSelection()).toMatchObject({ focus: { blockId: 'b1' } });
    keyDown('ArrowDown');
    expect(editor.getSelection()).toMatchObject({ focus: { blockId: 'b2' } });
  });

  it('Escape 進入 block selection 模式', () => {
    editor = create(['abc']);
    editor.focusBlock('b1', 1);
    keyDown('Escape');
    expect(editor.getSelection()).toEqual({ type: 'block', blockIds: ['b1'], anchorId: 'b1', focusId: 'b1' });
    expect(container.querySelector(`[${BLOCK_ID_ATTR}="b1"]`)!.getAttribute('data-selected')).toBe('true');
  });

  it('block selection 下 Shift+↓ 擴展選取，Backspace 批次刪除', () => {
    editor = create(['a', 'b', 'c']);
    editor.focusBlock('b1', 0);
    keyDown('Escape');
    keyDown('ArrowDown', { shiftKey: true });
    keyDown('ArrowDown', { shiftKey: true });
    expect(editor.getSelection()).toMatchObject({ type: 'block', blockIds: ['b1', 'b2', 'b3'] });
    keyDown('Backspace');
    expect(editor.getDoc().rootIds).toHaveLength(0);
  });

  it('Ctrl+A 一次選取整個 block，兩次升級為整頁 block selection', () => {
    editor = create(['abc', 'def']);
    editor.focusBlock('b1', 1);
    keyDown('a', { ctrlKey: true });
    expect(editor.getSelection()).toMatchObject({ anchor: { offset: 0 }, focus: { offset: 3 } });
    keyDown('a', { ctrlKey: true });
    expect(editor.getSelection()).toMatchObject({ type: 'block', blockIds: ['b1', 'b2'] });
  });

  it('Ctrl+B / Ctrl+I / Ctrl+U / Ctrl+E 套用格式', () => {
    editor = create(['abcd']);
    const select = () =>
      editor.setSelection({ type: 'text', anchor: { blockId: 'b1', offset: 0 }, focus: { blockId: 'b1', offset: 4 } });
    for (const [key, t] of [
      ['b', 'b'],
      ['i', 'i'],
      ['u', 'u'],
      ['e', 'code'],
    ] as const) {
      select();
      keyDown(key, { ctrlKey: true });
      expect(editor.getBlock('b1')!.content[0]!.marks?.some((m) => m.t === t)).toBe(true);
    }
  });

  it('Ctrl+Z / Ctrl+Y', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('abc');
    keyDown('z', { ctrlKey: true });
    expect(textOf('b1')).toBe('');
    keyDown('y', { ctrlKey: true });
    expect(textOf('b1')).toBe('abc');
  });
});

describe('MutationObserver 安全網', () => {
  it('正常輸入下零觸發', async () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    const spy = vi.fn();
    editor.on('reconcile', spy);
    type('hello world');
    beforeInput('insertParagraph');
    type('second line');
    beforeInput('deleteContentBackward');
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
    expect(editor.mutationTriggerCountForTest).toBe(0);
  });

  it('瀏覽器擅自改 DOM 時會對帳回 model', async () => {
    editor = create(['abc']);
    editor.focusBlock('b1', 3);
    contentElOf('b1').appendChild(document.createTextNode('XYZ'));
    await new Promise((r) => setTimeout(r, 10));
    expect(textOf('b1')).toBe('abcXYZ');
  });
});

describe('遠端 ops（協作）', () => {
  it('applyRemote 不進 undo stack、不 emit localOps', () => {
    editor = create(['abc']);
    const localOps = vi.fn();
    editor.on('localOps', localOps);
    editor.applyRemote([{ type: 'block.update', blockId: 'b1', patch: { content: [{ text: 'remote' }] } }]);
    expect(textOf('b1')).toBe('remote');
    expect(localOps).not.toHaveBeenCalled();
    expect(editor.history.canUndo).toBe(false);
  });

  it('遠端在游標前插入文字 → 本地游標跟著位移（rebaseSelection）', () => {
    editor = create(['abc']);
    editor.focusBlock('b1', 3);
    editor.applyRemote([{ type: 'block.update', blockId: 'b1', patch: { content: [{ text: 'XXabc' }] } }]);
    expect(editor.getSelection()).toMatchObject({ focus: { blockId: 'b1', offset: 5 } });
  });

  it('遠端刪掉游標所在的 block → 選取清空，不會炸', () => {
    editor = create(['abc', 'def']);
    editor.focusBlock('b2', 1);
    editor.applyRemote([{ type: 'block.delete', blockId: 'b2' }]);
    expect(editor.getSelection().type).toBe('none');
  });

  it('本地 ops 會 emit localOps（同步層的出口）', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    const localOps = vi.fn();
    editor.on('localOps', localOps);
    type('a');
    expect(localOps).toHaveBeenCalledTimes(1);
    expect(localOps.mock.calls[0]![0]).toHaveLength(1);
  });
});

describe('Slash / mention 觸發', () => {
  it('輸入 / 會通知宿主開選單，並帶 query', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    const spy = vi.fn();
    editor.on('slashTrigger', spy);
    type('/');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ open: true, blockId: 'b1', triggerOffset: 0, query: '' });
    type('cod');
    const last = spy.mock.calls[spy.mock.calls.length - 1]![0];
    expect(last).toMatchObject({ open: true, query: 'cod' });
  });

  it('全形頓號也能觸發（台灣使用者習慣）', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    const spy = vi.fn();
    editor.on('slashTrigger', spy);
    type('、');
    expect(spy).toHaveBeenCalled();
  });

  it('輸入 @ 觸發 mention', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    const spy = vi.fn();
    editor.on('mentionTrigger', spy);
    type('@');
    expect(spy).toHaveBeenCalled();
  });

  it('slash 選單開著時不跑 markdown 轉換', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    type('/# ');
    expect(editor.getBlock('b1')!.type).toBe('paragraph');
  });

  it('宿主選了項目 → 呼叫 setBlockType 即可', () => {
    editor = create(['']);
    editor.focusBlock('b1', 0);
    editor.setBlockType('b1', 'callout');
    expect(editor.getBlock('b1')!.type).toBe('callout');
    expect(container.querySelector('.kn-callout')).not.toBeNull();
  });
});

describe('Block registry 與渲染', () => {
  it('每個 block 有自己的 contenteditable 容器', () => {
    editor = create(['a', 'b']);
    const editables = container.querySelectorAll('[contenteditable="true"]');
    expect(editables).toHaveLength(2);
  });

  it('切換型別會換掉 DOM 結構但保留內容', () => {
    editor = create(['hello']);
    editor.setBlockType('b1', 'heading2');
    expect(container.querySelector('h3')).not.toBeNull();
    expect(textOf('b1')).toBe('hello');
  });

  it('未實作的型別走不可編輯的佔位 renderer', () => {
    editor = create(['x']);
    editor.setBlockType('b1', 'image');
    const placeholder = container.querySelector('[data-unimplemented]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.getAttribute('data-unimplemented')).toBe('image');
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it('divider 不可編輯', () => {
    editor = create(['']);
    editor.setBlockType('b1', 'divider');
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('slash menu 的搜尋支援中英文關鍵字', () => {
    editor = create(['']);
    expect(editor.registry.search('code').map((d) => d.type)).toContain('code');
    expect(editor.registry.search('程式').map((d) => d.type)).toContain('code');
    expect(editor.registry.search('待辦').map((d) => d.type)).toContain('todo');
  });

  it('todo 的勾選框可點擊切換', () => {
    editor = create(['task']);
    editor.setBlockType('b1', 'todo');
    const box = container.querySelector<HTMLElement>('[data-todo-checkbox]')!;
    // jsdom 沒有 PointerEvent，用 MouseEvent 送同名事件即可
    box.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(editor.getBlock('b1')!.props.checked).toBe(true);
  });
});

describe('Editor 生命週期', () => {
  it('destroy 之後不再接受變更，也不會留下 DOM', () => {
    editor = create(['abc']);
    editor.destroy();
    expect(container.querySelector('.kn-editor')).toBeNull();
    expect(editor.dispatch({ ops: [{ type: 'block.update', blockId: 'b1', patch: { content: [] } }] })).toBe(false);
  });

  it('on() 回傳的 unsubscribe 有效', () => {
    editor = create(['']);
    const spy = vi.fn();
    const off = editor.on('transaction', spy);
    off();
    editor.focusBlock('b1', 0);
    type('a');
    expect(spy).not.toHaveBeenCalled();
  });

  it('不合法的 operation 會被擋下且整批不套用（原子性）', () => {
    editor = create(['abc']);
    const ok = editor.dispatch({
      ops: [
        { type: 'block.update', blockId: 'b1', patch: { content: [{ text: 'changed' }] } },
        { type: 'block.update', blockId: 'ghost', patch: {} },
      ],
    });
    expect(ok).toBe(false);
    expect(textOf('b1')).toBe('abc');
  });
});
