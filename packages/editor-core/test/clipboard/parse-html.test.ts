/**
 * HTML 貼上解析器的測試。
 * @vitest-environment jsdom
 *
 * 重點是「真實世界的髒 HTML」：Word、Google Docs、Notion 的剪貼簿內容長得很不一樣，
 * 三者的樣本存成 fixture（test/clipboard/fixtures.ts）。
 */
import { describe, expect, it } from 'vitest';
import { parseHTMLToBlocks } from '../../src/clipboard/parse-html.js';
import { toPlainText } from '../../src/text/richtext.js';
import { GDOCS_HTML, NOTION_HTML, WORD_HTML } from './fixtures.js';

let n = 0;
const newId = () => `h${++n}`;

function parse(html: string) {
  n = 0;
  const fragment = parseHTMLToBlocks(html, { newId, document });
  return {
    fragment,
    roots: fragment.rootIds.map((id) => fragment.blocks[id]!),
    text: fragment.rootIds.map((id) => toPlainText(fragment.blocks[id]!.content)),
  };
}

describe('基本結構', () => {
  it('標題與段落', () => {
    const { roots } = parse('<h1>Title</h1><p>body</p><h4>deep</h4>');
    expect(roots.map((b) => b.type)).toEqual(['heading1', 'paragraph', 'heading3']);
  });

  it('清單（含巢狀）', () => {
    const { fragment, roots } = parse('<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>');
    expect(roots.map((b) => b.type)).toEqual(['bulletedList', 'bulletedList']);
    expect(roots[0]!.children).toHaveLength(1);
    expect(toPlainText(fragment.blocks[roots[0]!.children[0]!]!.content)).toBe('nested');
  });

  it('有序清單', () => {
    const { roots } = parse('<ol><li>a</li><li>b</li></ol>');
    expect(roots.every((b) => b.type === 'numberedList')).toBe(true);
  });

  it('引言、程式碼、分隔線', () => {
    const { roots } = parse('<blockquote>q</blockquote><pre><code class="language-ts">x();</code></pre><hr>');
    expect(roots.map((b) => b.type)).toEqual(['quote', 'code', 'divider']);
    expect(roots[1]!.props.language).toBe('ts');
  });

  it('行內格式', () => {
    const { roots } = parse('<p>a<strong>b</strong><em>c</em><u>d</u><s>e</s><code>f</code></p>');
    const marks = roots[0]!.content.map((node) => node.marks?.map((m) => m.t) ?? []);
    expect(marks).toEqual([[], ['b'], ['i'], ['u'], ['s'], ['code']]);
  });

  it('連結', () => {
    const { roots } = parse('<p><a href="https://x.example">link</a></p>');
    expect(roots[0]!.content[0]!.marks).toEqual([{ t: 'link', href: 'https://x.example' }]);
  });

  it('br 變成軟換行', () => {
    const { text } = parse('<p>a<br>b</p>');
    expect(text[0]).toBe('a\nb');
  });

  it('todo（checkbox 與 data-checked 兩種寫法）', () => {
    const a = parse('<ul><li><input type="checkbox" checked>done</li></ul>');
    expect(a.roots[0]!.type).toBe('todo');
    expect(a.roots[0]!.props.checked).toBe(true);
    const b = parse('<ul><li data-checked="false">todo</li></ul>');
    expect(b.roots[0]!.type).toBe('todo');
    expect(b.roots[0]!.props.checked).toBe(false);
  });

  it('表格降級為每列一個段落（M2-A 尚未實作 table block）', () => {
    const { text } = parse('<table><tr><td>a</td><td>b</td></tr></table>');
    expect(text[0]).toBe('a | b');
  });
});

describe('安全性', () => {
  it('script / style 一律丟棄', () => {
    const { text } = parse('<p>safe</p><script>alert(1)</script><style>p{}</style>');
    expect(text.join('')).toBe('safe');
  });

  it('on* 事件屬性不會被保留（我們根本不讀屬性）', () => {
    const { roots } = parse('<p onclick="alert(1)">x</p>');
    expect(JSON.stringify(roots)).not.toContain('alert');
  });

  it('javascript: 連結被擋掉，只保留文字', () => {
    const { roots } = parse('<p><a href="javascript:alert(1)">click</a></p>');
    expect(JSON.stringify(roots)).not.toContain('javascript');
    expect(toPlainText(roots[0]!.content)).toBe('click');
  });

  it('未知標籤只取文字內容', () => {
    const { text } = parse('<p>a<foo>b</foo>c</p>');
    expect(text[0]).toBe('abc');
  });
});

describe('真實世界的剪貼簿 HTML', () => {
  it('Word：MsoNormal + inline style 的粗體斜體', () => {
    const { roots } = parse(WORD_HTML);
    expect(roots.length).toBeGreaterThanOrEqual(2);
    expect(roots[0]!.type).toBe('heading1');
    const body = roots.find((b) => toPlainText(b.content).includes('粗體'));
    expect(body).toBeDefined();
    const boldSpan = body!.content.find((node) => node.marks?.some((m) => m.t === 'b'));
    expect(boldSpan).toBeDefined();
    // 不帶入 inline style 垃圾
    expect(JSON.stringify(roots)).not.toContain('mso-');
    expect(JSON.stringify(roots)).not.toContain('font-family');
  });

  it('Google Docs：外層 <b style="font-weight:normal"> 不可被誤判為粗體', () => {
    const { roots } = parse(GDOCS_HTML);
    const first = roots[0]!;
    const plain = first.content.find((node) => !node.marks || node.marks.length === 0);
    expect(plain).toBeDefined();
    const bold = roots.flatMap((b) => b.content).filter((node) => node.marks?.some((m) => m.t === 'b'));
    expect(bold).toHaveLength(1);
    expect(toPlainText([bold[0]!])).toBe('really bold');
  });

  it('Notion：標題 + 清單 + 待辦 + 程式碼', () => {
    const { roots } = parse(NOTION_HTML);
    const types = roots.map((b) => b.type);
    expect(types).toContain('heading2');
    expect(types).toContain('bulletedList');
    expect(types).toContain('todo');
    expect(types).toContain('code');
    expect(JSON.stringify(roots)).not.toContain('style');
  });
});
