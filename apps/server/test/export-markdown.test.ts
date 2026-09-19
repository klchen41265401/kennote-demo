/**
 * Markdown 匯出 ↔ 匯入的往返（04 §8 M6 驗收標準：匯出的 Markdown
 * 要能被 Obsidian / Typora 正常開啟 —— 其中一個必要條件就是
 * 「我們自己再讀回來，結構不能跑掉」）。
 *
 * blocks → md → editor-core 解析 → blocks，比對型別 / 純文字 / 巢狀深度。
 */
import { describe, expect, it } from 'vitest';
import type { Block as CoreBlock, DocFragment, RichText } from '@kennote/editor-core/src/model/types.js';
import { docToMarkdown, emptyContext, pageToMarkdown } from '../src/modules/export/markdown.js';
import { docToHtmlFragment, pageToHtml } from '../src/modules/export/html.js';
import { markdownToFragment } from '../src/modules/import/markdown.js';
import { relativePath, safeFileName } from '../src/modules/export/doc.js';

/* ── 小工具：用簡潔語法組 DocFragment ─────────────────── */

interface Spec {
  type: string;
  text?: string;
  props?: Record<string, unknown>;
  children?: Spec[];
}

let counter = 0;
const nextId = (): string => `b${++counter}`;

function build(specs: Spec[]): DocFragment {
  const blocks: Record<string, CoreBlock> = {};
  const make = (spec: Spec, parentId: string | null): string => {
    const id = nextId();
    const block: CoreBlock = {
      id,
      parentId,
      type: spec.type as CoreBlock['type'],
      props: spec.props ?? {},
      content: spec.text ? ([{ text: spec.text }] as RichText) : [],
      children: [],
      version: 1,
    };
    blocks[id] = block;
    for (const child of spec.children ?? []) block.children.push(make(child, id));
    return id;
  };
  const rootIds = specs.map((spec) => make(spec, null));
  return { rootIds, blocks };
}

interface Flat {
  type: string;
  text: string;
  depth: number;
}

function flatten(fragment: { rootIds: string[]; blocks: Record<string, CoreBlock> }): Flat[] {
  const out: Flat[] = [];
  const walk = (ids: string[], depth: number): void => {
    for (const id of ids) {
      const block = fragment.blocks[id];
      if (!block) continue;
      let text = '';
      for (const node of block.content) if ('text' in node) text += node.text;
      out.push({ type: block.type, text, depth });
      walk(block.children, depth + 1);
    }
  };
  walk(fragment.rootIds, 0);
  return out;
}

function roundTrip(specs: Spec[]): { before: Flat[]; after: Flat[]; markdown: string } {
  const fragment = build(specs);
  const markdown = docToMarkdown(fragment, emptyContext());
  const parsed = markdownToFragment(markdown, nextId, { extractTitle: false });
  return { before: flatten(fragment), after: flatten(parsed), markdown };
}

/* ── 往返 ─────────────────────────────────────────────── */

describe('blocks → markdown → blocks 往返', () => {
  it('標題、段落、分隔線', () => {
    const { before, after } = roundTrip([
      { type: 'heading1', text: '第一章' },
      { type: 'paragraph', text: '一段內文。' },
      { type: 'heading2', text: '小節' },
      { type: 'heading3', text: '更小的節' },
      { type: 'divider' },
      { type: 'paragraph', text: '結尾。' },
    ]);
    expect(after).toEqual(before);
  });

  it('清單與巢狀清單', () => {
    const { before, after, markdown } = roundTrip([
      {
        type: 'bulletedList',
        text: '外層',
        children: [
          { type: 'bulletedList', text: '內層 A' },
          { type: 'bulletedList', text: '內層 B', children: [{ type: 'bulletedList', text: '第三層' }] },
        ],
      },
      { type: 'bulletedList', text: '外層第二項' },
    ]);
    expect(markdown).toContain('- 外層');
    expect(markdown).toContain('  - 內層 A');
    expect(markdown).toContain('    - 第三層');
    expect(after).toEqual(before);
  });

  it('編號清單會連號', () => {
    const { after, markdown } = roundTrip([
      { type: 'numberedList', text: '一' },
      { type: 'numberedList', text: '二' },
      { type: 'numberedList', text: '三' },
    ]);
    expect(markdown).toContain('1. 一');
    expect(markdown).toContain('2. 二');
    expect(markdown).toContain('3. 三');
    expect(after.map((b) => b.type)).toEqual(['numberedList', 'numberedList', 'numberedList']);
  });

  it('待辦的勾選狀態（Obsidian / GitHub 的 `- [ ]`）', () => {
    const fragment = build([
      { type: 'todo', text: '沒做的', props: { checked: false } },
      { type: 'todo', text: '做完的', props: { checked: true } },
    ]);
    const markdown = docToMarkdown(fragment, emptyContext());
    expect(markdown).toContain('- [ ] 沒做的');
    expect(markdown).toContain('- [x] 做完的');

    const parsed = markdownToFragment(markdown, nextId, { extractTitle: false });
    const todos = Object.values(parsed.blocks).filter((b) => b.type === 'todo');
    expect(todos).toHaveLength(2);
    expect(todos.map((t) => t.props.checked).sort()).toEqual([false, true]);
  });

  it('引言與程式碼區塊（含語言）', () => {
    const fragment = build([
      { type: 'quote', text: '引用一句話' },
      { type: 'code', text: 'const a = 1;\nconsole.log(a);', props: { language: 'typescript' } },
    ]);
    const markdown = docToMarkdown(fragment, emptyContext());
    expect(markdown).toContain('> 引用一句話');
    expect(markdown).toContain('```typescript');

    const parsed = markdownToFragment(markdown, nextId, { extractTitle: false });
    const flat = flatten(parsed);
    expect(flat[0]).toEqual({ type: 'quote', text: '引用一句話', depth: 0 });
    expect(flat[1]!.type).toBe('code');
    expect(flat[1]!.text).toBe('const a = 1;\nconsole.log(a);');
    const code = Object.values(parsed.blocks).find((b) => b.type === 'code')!;
    expect(code.props.language).toBe('typescript');
  });

  it('行內格式（粗體 / 斜體 / 程式碼 / 連結）', () => {
    const id = nextId();
    const fragment: DocFragment = {
      rootIds: [id],
      blocks: {
        [id]: {
          id,
          parentId: null,
          type: 'paragraph',
          props: {},
          content: [
            { text: '粗', marks: [{ t: 'b' }] },
            { text: '斜', marks: [{ t: 'i' }] },
            { text: 'code', marks: [{ t: 'code' }] },
            { text: '連結', marks: [{ t: 'link', href: 'https://example.com' }] },
          ],
          children: [],
          version: 1,
        },
      },
    };
    const markdown = docToMarkdown(fragment, emptyContext());
    expect(markdown).toBe('**粗***斜*`code`[連結](https://example.com)');

    const parsed = markdownToFragment(markdown, nextId, { extractTitle: false });
    const block = parsed.blocks[parsed.rootIds[0]!]!;
    const marks = block.content.map((n) => ('marks' in n ? (n.marks ?? []).map((m) => m.t).join('+') : ''));
    expect(marks).toEqual(['b', 'i', 'code', 'link']);
  });

  it('圖片、公式、表格（editor-core 沒做、我們自己補的三種）', () => {
    const fragment = build([
      { type: 'image', props: { externalUrl: 'files/screenshot.png', altText: '截圖' } },
      { type: 'equation', props: { expression: 'E = mc^2' } },
      {
        type: 'table',
        props: { columnCount: 2, hasColumnHeader: true },
        children: [
          { type: 'tableRow', props: { cells: [[{ text: '欄一' }], [{ text: '欄二' }]] } },
          { type: 'tableRow', props: { cells: [[{ text: 'a' }], [{ text: 'b' }]] } },
        ],
      },
    ]);
    const markdown = docToMarkdown(fragment, emptyContext());
    expect(markdown).toContain('![截圖](files/screenshot.png)');
    expect(markdown).toContain('$$\nE = mc^2\n$$');
    expect(markdown).toContain('| 欄一 | 欄二 |');
    expect(markdown).toContain('| --- | --- |');

    const parsed = markdownToFragment(markdown, nextId, { extractTitle: false });
    const types = parsed.rootIds.map((id) => parsed.blocks[id]!.type);
    expect(types).toEqual(['image', 'equation', 'table']);
    const image = parsed.blocks[parsed.rootIds[0]!]!;
    expect(image.props.externalUrl).toBe('files/screenshot.png');
    expect(image.props.altText).toBe('截圖');
    const equation = parsed.blocks[parsed.rootIds[1]!]!;
    expect(equation.props.expression).toBe('E = mc^2');
    const table = parsed.blocks[parsed.rootIds[2]!]!;
    expect(table.children).toHaveLength(2);
    expect(table.props.columnCount).toBe(2);
  });
});

/* ── 只驗輸出形狀（往返會失真，已寫進 ADR 0005） ───── */

describe('callout / toggle 的 Markdown 表示', () => {
  it('callout 用 `> 💡 內容`（與 Notion 匯出一致）', () => {
    const markdown = docToMarkdown(
      build([{ type: 'callout', text: '注意事項', props: { icon: '⚠️' } }]),
      emptyContext(),
    );
    expect(markdown).toBe('> ⚠️ 注意事項');
  });

  it('toggle 用 <details>（Obsidian / GitHub 都吃得下）', () => {
    const markdown = docToMarkdown(
      build([{ type: 'toggle', text: '展開看看', children: [{ type: 'paragraph', text: '裡面的內容' }] }]),
      emptyContext(),
    );
    expect(markdown).toContain('<details>');
    expect(markdown).toContain('<summary>展開看看</summary>');
    expect(markdown).toContain('裡面的內容');
    expect(markdown).toContain('</details>');
  });
});

describe('頁面層級的匯出', () => {
  const page = {
    id: '11111111-1111-1111-1111-111111111111',
    workspaceId: 'w',
    parentId: null,
    title: '我的頁面',
    icon: '📘',
    isDatabase: false,
    collectionId: null,
    properties: {},
    updatedAt: '2026-09-19T00:00:00.000Z',
    doc: build([{ type: 'paragraph', text: '內文' }]),
  };

  it('Markdown 以 `# icon 標題` 開頭', () => {
    expect(pageToMarkdown(page, emptyContext())).toBe('# 📘 我的頁面\n\n內文');
  });

  it('HTML 是自包含的單檔（內嵌樣式 + 列印樣式）', () => {
    const html = pageToHtml(page, emptyContext());
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>我的頁面</title>');
    expect(html).toContain('class="page-body"');
    expect(html).toContain('@media print');
    expect(html).not.toContain('<link rel="stylesheet"');
  });

  it('HTML 逸出使用者內容，不會產生 XSS', () => {
    const evil = build([{ type: 'paragraph', text: '<img src=x onerror=alert(1)>' }]);
    const html = docToHtmlFragment(evil, emptyContext());
    // `<` 被逸出 → 瀏覽器看到的是文字而不是標籤，onerror 永遠不會被執行
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('檔名與相對路徑', () => {
  it('safeFileName 去掉三個作業系統都不接受的字元', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
    expect(safeFileName('')).toBe('未命名');
    expect(safeFileName('   ...   ')).toBe('未命名');
  });

  it('relativePath 算出 zip 內的相對連結', () => {
    expect(relativePath('A/B.md', 'A/C.md')).toBe('C.md');
    expect(relativePath('A/B.md', 'A/B/D.md')).toBe('B/D.md');
    expect(relativePath('A/B/D.md', 'files/x.png')).toBe('../../files/x.png');
    expect(relativePath('Root.md', 'files/x.png')).toBe('files/x.png');
  });
});
