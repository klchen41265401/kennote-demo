import { describe, expect, it } from 'vitest';
import {
  looksLikeMarkdown,
  parseInlineMarkdown,
  parseMarkdownToBlocks,
  parsePlainTextToBlocks,
} from '../../src/clipboard/parse-markdown.js';
import { toPlainText } from '../../src/text/richtext.js';

let n = 0;
const newId = () => `m${++n}`;
const parse = (md: string) => {
  n = 0;
  const f = parseMarkdownToBlocks(md, { newId });
  return f.rootIds.map((id) => f.blocks[id]!);
};

describe('行內 markdown', () => {
  it('粗體 / 斜體 / 刪除線 / 行內程式碼', () => {
    expect(parseInlineMarkdown('**bold**')).toEqual([{ text: 'bold', marks: [{ t: 'b' }] }]);
    expect(parseInlineMarkdown('*it*')).toEqual([{ text: 'it', marks: [{ t: 'i' }] }]);
    expect(parseInlineMarkdown('_it_')).toEqual([{ text: 'it', marks: [{ t: 'i' }] }]);
    expect(parseInlineMarkdown('~~del~~')).toEqual([{ text: 'del', marks: [{ t: 's' }] }]);
    expect(parseInlineMarkdown('`code`')).toEqual([{ text: 'code', marks: [{ t: 'code' }] }]);
  });

  it('連結', () => {
    expect(parseInlineMarkdown('[kennote](https://k.example)')).toEqual([
      { text: 'kennote', marks: [{ t: 'link', href: 'https://k.example' }] },
    ]);
  });

  it('javascript: 連結會被擋掉（XSS 防線）', () => {
    const out = parseInlineMarkdown('[x](javascript:alert(1))');
    expect(JSON.stringify(out)).not.toContain('javascript');
  });

  it('混合文字', () => {
    const out = parseInlineMarkdown('hi **bold** and `code`');
    expect(toPlainText(out)).toBe('hi bold and code');
    expect(out).toHaveLength(4);
  });

  it('巢狀格式（粗體內含行內程式碼）', () => {
    const out = parseInlineMarkdown('**bold `code`**');
    const inner = out.find((nd) => 'text' in nd && nd.text === 'code');
    expect(inner?.marks?.map((m) => m.t).sort()).toEqual(['b', 'code']);
  });

  it('已知限制：***粗斜體*** 的三連星號不支援（見 README）', () => {
    const out = parseInlineMarkdown('***x***');
    expect(toPlainText(out)).toContain('x');
  });

  it('跳脫字元', () => {
    expect(parseInlineMarkdown('\\*not italic\\*')).toEqual([{ text: '*not italic*' }]);
  });
});

describe('區塊 markdown', () => {
  it('標題', () => {
    const blocks = parse('# H1\n## H2\n### H3\n#### H4');
    expect(blocks.map((b) => b.type)).toEqual(['heading1', 'heading2', 'heading3', 'heading3']);
  });

  it('清單與待辦', () => {
    const blocks = parse('- one\n* two\n1. three\n- [ ] todo\n- [x] done');
    expect(blocks.map((b) => b.type)).toEqual(['bulletedList', 'bulletedList', 'numberedList', 'todo', 'todo']);
    expect(blocks[4]!.props.checked).toBe(true);
    expect(blocks[3]!.props.checked).toBe(false);
  });

  it('巢狀清單（縮排 → children）', () => {
    n = 0;
    const f = parseMarkdownToBlocks('- parent\n  - child\n    - grand', { newId });
    expect(f.rootIds).toHaveLength(1);
    const parent = f.blocks[f.rootIds[0]!]!;
    expect(parent.children).toHaveLength(1);
    const child = f.blocks[parent.children[0]!]!;
    expect(toPlainText(child.content)).toBe('child');
    expect(child.children).toHaveLength(1);
  });

  it('引言與分隔線', () => {
    const blocks = parse('> quote\n\n---');
    expect(blocks.map((b) => b.type)).toEqual(['quote', 'divider']);
  });

  it('程式碼區塊保留原始換行與語言', () => {
    const blocks = parse('```ts\nconst a = 1;\nconst b = 2;\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('code');
    expect(blocks[0]!.props.language).toBe('ts');
    expect(toPlainText(blocks[0]!.content)).toBe('const a = 1;\nconst b = 2;');
  });

  it('段落中的 markdown 行內語法也會解析', () => {
    const blocks = parse('這是 **粗體** 測試');
    expect(blocks[0]!.type).toBe('paragraph');
    expect(blocks[0]!.content.some((nd) => nd.marks?.some((m) => m.t === 'b'))).toBe(true);
  });

  it('空行分段', () => {
    const blocks = parse('one\n\ntwo');
    expect(blocks).toHaveLength(2);
  });
});

describe('純文字 fallback', () => {
  it('按行分段', () => {
    n = 0;
    const f = parsePlainTextToBlocks('a\nb\n\nc', { newId });
    expect(f.rootIds).toHaveLength(3);
  });

  it('looksLikeMarkdown 判斷', () => {
    expect(looksLikeMarkdown('# title')).toBe(true);
    expect(looksLikeMarkdown('- item')).toBe(true);
    expect(looksLikeMarkdown('**b**')).toBe(true);
    expect(looksLikeMarkdown('just plain text')).toBe(false);
  });
});
