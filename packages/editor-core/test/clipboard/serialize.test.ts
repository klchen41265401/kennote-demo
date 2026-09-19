import { describe, expect, it } from 'vitest';
import type { DocFragment } from '../../src/model/types.js';
import { createDefaultRegistry } from '../../src/plugins/block-registry.js';
import {
  extractFragment,
  fragmentToHTML,
  fragmentToMarkdown,
  fragmentToPlainText,
  inlineToHTML,
  inlineToMarkdown,
  reassignIds,
} from '../../src/clipboard/serialize.js';

const registry = createDefaultRegistry();

function frag(): DocFragment {
  return {
    rootIds: ['h', 'p', 'l1', 'l2', 't', 'c'],
    blocks: {
      h: { id: 'h', parentId: null, type: 'heading1', props: {}, content: [{ text: 'Title' }], children: [], version: 1 },
      p: {
        id: 'p',
        parentId: null,
        type: 'paragraph',
        props: {},
        content: [{ text: 'a ' }, { text: 'bold', marks: [{ t: 'b' }] }],
        children: ['sub'],
        version: 1,
      },
      sub: { id: 'sub', parentId: 'p', type: 'paragraph', props: {}, content: [{ text: 'nested' }], children: [], version: 1 },
      l1: { id: 'l1', parentId: null, type: 'bulletedList', props: {}, content: [{ text: 'one' }], children: [], version: 1 },
      l2: { id: 'l2', parentId: null, type: 'bulletedList', props: {}, content: [{ text: 'two' }], children: [], version: 1 },
      t: { id: 't', parentId: null, type: 'todo', props: { checked: true }, content: [{ text: 'done' }], children: [], version: 1 },
      c: { id: 'c', parentId: null, type: 'code', props: { language: 'ts' }, content: [{ text: 'x();' }], children: [], version: 1 },
    },
  };
}

describe('行內序列化', () => {
  it('HTML 用語義標籤', () => {
    expect(inlineToHTML([{ text: 'x', marks: [{ t: 'b' }, { t: 'i' }] }])).toBe('<strong><em>x</em></strong>');
    expect(inlineToHTML([{ text: 'x', marks: [{ t: 'link', href: 'https://a.example/' }] }])).toBe(
      '<a href="https://a.example/">x</a>',
    );
  });

  it('HTML 會逸出危險字元（XSS 防線）', () => {
    expect(inlineToHTML([{ text: '<script>alert(1)</script>' }])).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('javascript: 連結不會輸出成 <a>', () => {
    expect(inlineToHTML([{ text: 'x', marks: [{ t: 'link', href: 'javascript:alert(1)' }] }])).toBe('x');
  });

  it('Markdown 用對應語法', () => {
    expect(inlineToMarkdown([{ text: 'x', marks: [{ t: 'b' }] }])).toBe('**x**');
    expect(inlineToMarkdown([{ text: 'x', marks: [{ t: 'code' }] }])).toBe('`x`');
    expect(inlineToMarkdown([{ text: 'x', marks: [{ t: 's' }] }])).toBe('~~x~~');
  });

  it('軟換行在 HTML 是 <br>', () => {
    expect(inlineToHTML([{ text: 'a\nb' }])).toBe('a<br>b');
  });
});

describe('Fragment 序列化', () => {
  it('HTML：連續清單項會被包進 ul', () => {
    const html = fragmentToHTML(frag(), registry);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul><li>one</li><li>two</li>');
    expect(html).toContain('<pre><code class="language-ts">x();</code></pre>');
  });

  it('Markdown：巢狀會縮排，todo 有勾選狀態', () => {
    const md = fragmentToMarkdown(frag(), registry);
    expect(md).toContain('# Title');
    expect(md).toContain('a **bold**');
    expect(md).toContain('  nested');
    expect(md).toContain('- [x] done');
    expect(md).toContain('```ts');
  });

  it('編號清單會重新編號', () => {
    const f: DocFragment = {
      rootIds: ['a', 'b'],
      blocks: {
        a: { id: 'a', parentId: null, type: 'numberedList', props: {}, content: [{ text: 'one' }], children: [], version: 1 },
        b: { id: 'b', parentId: null, type: 'numberedList', props: {}, content: [{ text: 'two' }], children: [], version: 1 },
      },
    };
    expect(fragmentToMarkdown(f, registry)).toBe('1. one\n2. two');
  });

  it('純文字是每個 block 一行', () => {
    expect(fragmentToPlainText(frag()).split('\n')).toHaveLength(7);
  });
});

describe('extractFragment / reassignIds', () => {
  it('抽出的片段包含子孫', () => {
    const f = extractFragment(frag(), ['p']);
    expect(f.rootIds).toEqual(['p']);
    expect(Object.keys(f.blocks).sort()).toEqual(['p', 'sub']);
    expect(f.blocks.p!.parentId).toBeNull();
  });

  it('換 id 後父子關係仍然正確', () => {
    let n = 0;
    const renamed = reassignIds(extractFragment(frag(), ['p']), () => `new${++n}`);
    const root = renamed.blocks[renamed.rootIds[0]!]!;
    expect(root.id).toMatch(/^new/);
    expect(root.children).toHaveLength(1);
    expect(renamed.blocks[root.children[0]!]!.parentId).toBe(root.id);
  });
});
