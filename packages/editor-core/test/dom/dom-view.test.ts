/**
 * @vitest-environment jsdom
 *
 * 增量渲染的重點：打字時「不重建節點」——重建節點 = caret 消失。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { RichText } from '../../src/model/types.js';
import { renderInline } from '../../src/view/dom-view.js';
import { BLOCK_CONTENT_ATTR } from '../../src/selection/dom-mapper.js';

let contentEl: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  contentEl = document.createElement('div');
  contentEl.setAttribute(BLOCK_CONTENT_ATTR, 'true');
  document.body.appendChild(contentEl);
});

describe('renderInline 增量更新', () => {
  it('只改文字時，DOM 節點的參考完全不變', () => {
    renderInline(contentEl, [{ text: 'Hello' }]);
    const span = contentEl.firstChild as HTMLElement;
    const textNode = span.firstChild as Text;

    renderInline(contentEl, [{ text: 'Hellox' }]);

    expect(contentEl.firstChild).toBe(span); // 元素沒被重建
    expect(span.firstChild).toBe(textNode); // 文字節點也沒被重建
    expect(textNode.data).toBe('Hellox');
  });

  it('內容完全相同時不動 DOM', () => {
    const rt: RichText = [{ text: 'a' }, { text: 'b', marks: [{ t: 'b' }] }];
    renderInline(contentEl, rt);
    const mutated = renderInline(contentEl, rt);
    expect(mutated).toBe(false);
  });

  it('格式改變時才替換該 span，其他 span 不動', () => {
    renderInline(contentEl, [{ text: 'a' }, { text: 'b', marks: [{ t: 'u' }] }, { text: 'c', marks: [{ t: 'i' }] }]);
    const nodes = Array.from(contentEl.children);
    expect(nodes).toHaveLength(3);
    renderInline(contentEl, [{ text: 'a' }, { text: 'b', marks: [{ t: 'u' }] }, { text: 'c', marks: [{ t: 'b' }] }]);
    const after = Array.from(contentEl.children);
    expect(after[0]).toBe(nodes[0]);
    expect(after[1]).toBe(nodes[1]);
    expect(after[2]).not.toBe(nodes[2]);
  });

  it('span 數量減少時會移除多餘節點', () => {
    renderInline(contentEl, [{ text: 'a' }, { text: 'b', marks: [{ t: 'b' }] }]);
    expect(contentEl.querySelectorAll('[data-idx]')).toHaveLength(2);
    renderInline(contentEl, [{ text: 'ab' }]);
    expect(contentEl.querySelectorAll('[data-idx]')).toHaveLength(1);
  });

  it('空內容會留下佔位 br，且重複渲染不會一直換新的 br', () => {
    renderInline(contentEl, []);
    const br = contentEl.querySelector('br');
    expect(br).not.toBeNull();
    renderInline(contentEl, []);
    expect(contentEl.querySelector('br')).toBe(br);
    expect(contentEl.querySelectorAll('br')).toHaveLength(1);
  });

  it('從空變成有內容，br 會被移除', () => {
    renderInline(contentEl, []);
    renderInline(contentEl, [{ text: 'x' }]);
    expect(contentEl.querySelector('br')).toBeNull();
    expect(contentEl.textContent).toBe('x');
  });

  it('data-empty 屬性反映空狀態（placeholder 靠它顯示）', () => {
    renderInline(contentEl, [], { placeholder: '輸入文字' });
    expect(contentEl.hasAttribute('data-empty')).toBe(true);
    expect(contentEl.getAttribute('data-placeholder')).toBe('輸入文字');
    renderInline(contentEl, [{ text: 'x' }], { placeholder: '輸入文字' });
    expect(contentEl.hasAttribute('data-empty')).toBe(false);
  });

  it('連結渲染成 <a> 並帶 rel', () => {
    renderInline(contentEl, [{ text: 'x', marks: [{ t: 'link', href: 'https://a.example/' }] }]);
    const a = contentEl.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://a.example/');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('危險的 href 會被清成空字串', () => {
    renderInline(contentEl, [{ text: 'x', marks: [{ t: 'link', href: 'javascript:alert(1)' }] }]);
    expect(contentEl.querySelector('a')!.getAttribute('href')).toBe('');
  });

  it('color mark 走 inline style', () => {
    renderInline(contentEl, [{ text: 'x', marks: [{ t: 'color', fg: 'red', bg: 'yellow' }] }]);
    const span = contentEl.firstElementChild as HTMLElement;
    expect(span.style.color).toBe('red');
    expect(span.style.backgroundColor).toBe('yellow');
  });

  it('瀏覽器塞進來的雜節點會被清掉', () => {
    renderInline(contentEl, [{ text: 'a' }]);
    contentEl.appendChild(document.createTextNode('junk'));
    renderInline(contentEl, [{ text: 'a' }]);
    expect(contentEl.textContent).toBe('a');
  });

  it('結尾是換行時會補一個 br（否則 pre-wrap 下最後一行不顯示）', () => {
    renderInline(contentEl, [{ text: 'a\n' }]);
    expect(contentEl.querySelector('br')).not.toBeNull();
  });
});
