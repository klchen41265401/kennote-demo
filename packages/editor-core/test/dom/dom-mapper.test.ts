/**
 * @vitest-environment jsdom
 *
 * dom-mapper 是自刻編輯器最容易出錯、且錯誤症狀最隱晦的模組。
 * 涵蓋：空 block、純文字、多 span、含 atom、surrogate pair、邊界 offset、元素邊界 fallback。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { RichText } from '../../src/model/types.js';
import { renderInline } from '../../src/view/dom-view.js';
import {
  BLOCK_CONTENT_ATTR,
  BLOCK_ID_ATTR,
  closestBlock,
  domToModel,
  domToRichText,
  getContentEl,
  measureNode,
  modelToDom,
} from '../../src/selection/dom-mapper.js';
import { length, normalize } from '../../src/text/richtext.js';

const EMOJI = '😀';
const RARE = '𠮷';

let blockEl: HTMLElement;
let contentEl: HTMLElement;

function mount(rt: RichText): HTMLElement {
  blockEl = document.createElement('div');
  blockEl.setAttribute(BLOCK_ID_ATTR, 'b1');
  contentEl = document.createElement('div');
  contentEl.setAttribute(BLOCK_CONTENT_ATTR, 'true');
  contentEl.setAttribute('contenteditable', 'true');
  blockEl.appendChild(contentEl);
  document.body.appendChild(blockEl);
  renderInline(contentEl, rt);
  return contentEl;
}

/** 對每個 model offset 做 model → DOM → model 的 round trip。 */
function expectRoundTrip(rt: RichText): void {
  const total = length(normalize(rt));
  for (let offset = 0; offset <= total; offset++) {
    const pos = modelToDom(contentEl, offset);
    expect(domToModel(contentEl, pos.node, pos.offset)).toBe(offset);
  }
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('空 block', () => {
  it('渲染出佔位 br，且不佔任何 model 長度', () => {
    mount([]);
    expect(contentEl.querySelector('br')).not.toBeNull();
    expect(measureNode(contentEl)).toBe(0);
  });

  it('modelToDom(0) 回到容器本身', () => {
    mount([]);
    const pos = modelToDom(contentEl, 0);
    expect(pos.node).toBe(contentEl);
    expect(pos.offset).toBe(0);
  });

  it('domToModel 對空 block 永遠是 0', () => {
    mount([]);
    expect(domToModel(contentEl, contentEl, 0)).toBe(0);
    expect(domToModel(contentEl, contentEl, 1)).toBe(0);
  });
});

describe('純文字', () => {
  const rt: RichText = [{ text: 'Hello' }];

  it('每個 offset 都能 round trip', () => {
    mount(rt);
    expectRoundTrip(rt);
  });

  it('text node 的 offset 直接對應', () => {
    mount(rt);
    const textNode = contentEl.firstChild!.firstChild!;
    expect(domToModel(contentEl, textNode, 3)).toBe(3);
  });

  it('超出範圍會夾到結尾', () => {
    mount(rt);
    const pos = modelToDom(contentEl, 99);
    expect(domToModel(contentEl, pos.node, pos.offset)).toBe(5);
  });
});

describe('多 span', () => {
  const rt: RichText = [{ text: 'Hello ' }, { text: 'world', marks: [{ t: 'b' }] }, { text: '!' }];

  it('渲染成三個帶 data-idx 的元素', () => {
    mount(rt);
    expect(contentEl.querySelectorAll('[data-idx]')).toHaveLength(3);
  });

  it('每個 offset 都能 round trip', () => {
    mount(rt);
    expectRoundTrip(rt);
  });

  it('跨 span 的邊界 offset：6 落在第二個 span 的開頭', () => {
    mount(rt);
    const pos = modelToDom(contentEl, 6);
    expect(domToModel(contentEl, pos.node, pos.offset)).toBe(6);
  });

  it('元素邊界（selection 落在容器上）也能算出正確 offset', () => {
    mount(rt);
    // 容器的第 1 個子節點之後 = 第一個 span 的長度
    expect(domToModel(contentEl, contentEl, 1)).toBe(6);
    expect(domToModel(contentEl, contentEl, 2)).toBe(11);
    expect(domToModel(contentEl, contentEl, 0)).toBe(0);
  });
});

describe('含 atom', () => {
  const rt: RichText = [{ text: 'hi ' }, { atom: 'mention', data: { id: 'u1', text: 'Ken' } }, { text: ' bye' }];

  it('atom 只佔 1 個 model offset，不論它顯示幾個字', () => {
    mount(rt);
    expect(length(rt)).toBe(8);
    expect(measureNode(contentEl)).toBe(8);
  });

  it('atom 元素是 contenteditable=false 且不可分割', () => {
    mount(rt);
    const atomEl = contentEl.querySelector('[data-atom]')!;
    expect(atomEl.getAttribute('contenteditable')).toBe('false');
    // 落在 atom 內部的位置會被夾到前緣或後緣
    const inner = atomEl.firstChild!;
    expect(domToModel(contentEl, inner, 0)).toBe(3);
    expect(domToModel(contentEl, inner, (inner as Text).data.length)).toBe(4);
  });

  it('每個 offset 都能 round trip', () => {
    mount(rt);
    expectRoundTrip(rt);
  });
});

describe('surrogate pair', () => {
  const rt: RichText = [{ text: `a${EMOJI}b${RARE}` }];

  it('model offset 是 code point，DOM offset 是 UTF-16', () => {
    mount(rt);
    expect(length(rt)).toBe(4);
    const textNode = contentEl.firstChild!.firstChild as Text;
    expect(textNode.data.length).toBe(6); // UTF-16 長度
    expect(modelToDom(contentEl, 2).offset).toBe(3);
    expect(domToModel(contentEl, textNode, 3)).toBe(2);
  });

  it('每個 offset 都能 round trip', () => {
    mount(rt);
    expectRoundTrip(rt);
  });

  it('emoji 與 CJK 混排', () => {
    const mixed: RichText = [{ text: '中😀文' }, { text: RARE, marks: [{ t: 'b' }] }];
    mount(mixed);
    expectRoundTrip(mixed);
  });
});

describe('domToRichText（IME / MutationObserver 對帳用）', () => {
  it('讀回自己渲染的內容 === 原本的 model', () => {
    const rt: RichText = [{ text: 'Hello ' }, { text: 'world', marks: [{ t: 'b' }] }];
    mount(rt);
    expect(domToRichText(contentEl)).toEqual(normalize(rt));
  });

  it('忽略佔位 br', () => {
    mount([]);
    expect(domToRichText(contentEl)).toEqual([]);
  });

  it('讀得回 atom', () => {
    const rt: RichText = [{ atom: 'mention', data: { id: 'u1', text: 'Ken' } }];
    mount(rt);
    const back = domToRichText(contentEl);
    expect(back).toHaveLength(1);
    expect((back[0] as { atom: string }).atom).toBe('mention');
  });

  it('瀏覽器塞進來的 <b> 會被推導成 bold mark', () => {
    mount([{ text: 'a' }]);
    const stray = document.createElement('b');
    stray.textContent = 'B';
    contentEl.appendChild(stray);
    expect(domToRichText(contentEl)).toEqual([{ text: 'a' }, { text: 'B', marks: [{ t: 'b' }] }]);
  });

  it('Firefox 的 br[type=_moz] 會被過濾掉', () => {
    mount([{ text: 'a' }]);
    const moz = document.createElement('br');
    moz.setAttribute('type', '_moz');
    contentEl.appendChild(moz);
    expect(domToRichText(contentEl)).toEqual([{ text: 'a' }]);
  });

  it('連結會被讀回 link mark', () => {
    const rt: RichText = [{ text: 'x', marks: [{ t: 'link', href: 'https://a.example/' }] }];
    mount(rt);
    expect(domToRichText(contentEl)).toEqual(normalize(rt));
  });
});

describe('closestBlock / getContentEl', () => {
  it('從任意子節點往上找到 block 容器', () => {
    mount([{ text: 'abc' }]);
    const textNode = contentEl.firstChild!.firstChild!;
    expect(closestBlock(textNode)).toBe(blockEl);
    expect(getContentEl(blockEl)).toBe(contentEl);
  });

  it('不會誤抓巢狀子 block 的內容元素', () => {
    mount([{ text: 'parent' }]);
    const childBlock = document.createElement('div');
    childBlock.setAttribute(BLOCK_ID_ATTR, 'b2');
    const childContent = document.createElement('div');
    childContent.setAttribute(BLOCK_CONTENT_ATTR, 'true');
    childBlock.appendChild(childContent);
    blockEl.appendChild(childBlock);
    expect(getContentEl(blockEl)).toBe(contentEl);
    expect(getContentEl(childBlock)).toBe(childContent);
  });
});
