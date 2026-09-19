import { describe, expect, it } from 'vitest';
import {
  CODE_LANGUAGES,
  countLines,
  HIGHLIGHTED_LANGUAGES,
  languageLabel,
  normalizeLanguage,
  tokenize,
} from '../lib/highlight';
import { domainOf, isDirectImage, isDirectVideo, normalizeUrlInput, resolveEmbed, safeHref } from '../lib/embed';
import { latexToMathML } from '../lib/mathml';
import { pointRect, positionFloating } from '../lib/floating';
import { autoScrollSpeed, computeDropTarget, indicatorGeometry, type BlockRect } from '../dnd/drop-target';
import { bareUrl, linkRichText, parseMarkdownTable, tableOps } from '../lib/paste-extras';
import { hostAtomText } from '../useEditorHost';

describe('語法高亮 tokenizer', () => {
  it('提供 30 種以上語言', () => {
    expect(CODE_LANGUAGES.length).toBeGreaterThanOrEqual(30);
  });

  it('規格要求的語言都有專屬規則', () => {
    for (const id of ['javascript', 'typescript', 'python', 'json', 'sql', 'bash', 'html', 'css', 'markdown']) {
      expect(HIGHLIGHTED_LANGUAGES, `${id} 沒有專屬規則`).toContain(id);
    }
  });

  it('別名會被正規化', () => {
    expect(normalizeLanguage('ts')).toBe('typescript');
    expect(normalizeLanguage('JS')).toBe('javascript');
    expect(normalizeLanguage('py')).toBe('python');
    expect(normalizeLanguage('未知語言')).toBe('plain');
    expect(languageLabel('ts')).toBe('TypeScript');
  });

  const samples: [string, string][] = [
    ['javascript', 'const a = 1; // hi\nfunction f(x) { return `t${x}`; }'],
    ['typescript', 'interface A { b: string }\nconst x: A = { b: "y" };'],
    ['python', 'def f(x):\n    # comment\n    return "ok" if x else None'],
    ['json', '{"a": 1, "b": [true, null], "c": "d"}'],
    ['sql', 'SELECT id, name FROM users WHERE id = 1 -- note'],
    ['bash', '#!/bin/bash\nfor f in *.ts; do echo "$f"; done'],
    ['html', '<div class="a" id=\'b\'><!-- c --></div>'],
    ['css', '.a { color: red; --x: 1px; }\n@media print { .b { top: 0 } }'],
    ['markdown', '# Title\n\n- item **bold** `code`\n\n[link](http://a.b)'],
  ];

  it.each(samples)('%s：token 串接後等於原始碼（不吞字、不重複）', (lang, code) => {
    const tokens = tokenize(code, lang);
    expect(tokens.map((t) => t.text).join('')).toBe(code);
  });

  it.each(samples)('%s：至少辨識出一個非 plain 的 token', (lang, code) => {
    const tokens = tokenize(code, lang);
    expect(tokens.some((t) => t.type !== 'plain')).toBe(true);
  });

  it('plain 不做任何比對', () => {
    const code = 'const a = 1';
    expect(tokenize(code, 'plain')).toEqual([{ text: code, type: 'plain' }]);
    expect(tokenize('', 'plain')).toEqual([]);
  });

  it('未收錄的語言走泛用規則，仍然保證不吞字', () => {
    const code = 'fn main() { /* x */ println!("hi"); }';
    expect(tokenize(code, 'rust').map((t) => t.text).join('')).toBe(code);
  });

  it('未關閉的字串 / 註解不會無限迴圈', () => {
    expect(tokenize('const a = "unterminated', 'javascript').map((t) => t.text).join('')).toBe(
      'const a = "unterminated',
    );
    expect(tokenize('/* never closed', 'javascript').map((t) => t.text).join('')).toBe('/* never closed');
  });

  it('countLines', () => {
    expect(countLines('')).toBe(1);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\n')).toBe(3);
  });
});

describe('嵌入白名單', () => {
  it.each([
    ['https://www.youtube.com/watch?v=abc123', 'YouTube'],
    ['https://youtu.be/abc123', 'YouTube'],
    ['https://vimeo.com/123456789', 'Vimeo'],
    ['https://www.figma.com/file/xxx/Design', 'Figma'],
    ['https://codepen.io/user/pen/abc', 'CodePen'],
    ['https://docs.google.com/document/d/xxx/edit', 'Google'],
  ])('%s → %s', (url, provider) => {
    expect(resolveEmbed(url)?.provider).toBe(provider);
  });

  it('白名單之外一律回 null（呼叫端降級成書籤卡）', () => {
    expect(resolveEmbed('https://evil.example.com/x')).toBeNull();
    expect(resolveEmbed('not a url')).toBeNull();
  });

  it('非 http(s) 協定一律擋掉', () => {
    expect(resolveEmbed('javascript:alert(1)')).toBeNull();
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('https://a.b/c')).toBe('https://a.b/c');
  });

  it('YouTube 轉成 nocookie 的 embed URL', () => {
    expect(resolveEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.src).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
  });

  it('domainOf / normalizeUrlInput / 直接播放判斷', () => {
    expect(domainOf('https://www.example.com/a')).toBe('example.com');
    expect(normalizeUrlInput('example.com')).toBe('https://example.com');
    expect(normalizeUrlInput('https://example.com')).toBe('https://example.com');
    expect(normalizeUrlInput('  ')).toBe('');
    expect(isDirectVideo('https://a.b/c.mp4')).toBe(true);
    expect(isDirectVideo('https://a.b/c.png')).toBe(false);
    expect(isDirectImage('https://a.b/c.PNG')).toBe(true);
  });
});

describe('LaTeX 子集 → MathML', () => {
  it('上下標 / 分數 / 根號 / 希臘字母', () => {
    expect(latexToMathML('x^2')).toContain('<msup>');
    expect(latexToMathML('a_i')).toContain('<msub>');
    expect(latexToMathML('\\frac{a}{b}')).toContain('<mfrac>');
    expect(latexToMathML('\\sqrt{x}')).toContain('<msqrt>');
    expect(latexToMathML('\\alpha + \\beta')).toContain('α');
  });

  it('display 模式', () => {
    expect(latexToMathML('E = mc^2', true)).toContain('display="block"');
    expect(latexToMathML('E = mc^2', false)).not.toContain('display="block"');
  });

  it('前後的 $ 會被剝掉', () => {
    expect(latexToMathML('$x+1$')).toBe(latexToMathML('x+1'));
  });

  it('不支援的語法回 null（呼叫端退回原樣顯示，不猜）', () => {
    expect(latexToMathML('\\begin{matrix} a \\end{matrix}')).toBeNull();
    expect(latexToMathML('')).toBeNull();
    expect(latexToMathML('\\frac{a}')).toBeNull();
  });

  it('文字會被 escape，不會產生額外標籤', () => {
    const out = latexToMathML('a<b');
    expect(out === null || out.includes('&lt;')).toBe(true);
  });
});

describe('浮層定位', () => {
  const viewport = { width: 1000, height: 800 };

  it('預設擺在錨點下方', () => {
    const r = positionFloating(
      { top: 100, bottom: 120, left: 200, right: 260, width: 60, height: 20 },
      { width: 300, height: 200 },
      { viewport, offset: 4 },
    );
    expect(r.placement).toBe('bottom-start');
    expect(r.top).toBe(124);
    expect(r.left).toBe(200);
  });

  it('下方空間不足時自動翻轉到上方', () => {
    const r = positionFloating(
      { top: 700, bottom: 720, left: 200, right: 260, width: 60, height: 20 },
      { width: 300, height: 300 },
      { viewport },
    );
    expect(r.placement).toBe('top-start');
  });

  it('水平方向會被夾在視窗內（shift）', () => {
    const r = positionFloating(
      { top: 100, bottom: 120, left: 950, right: 990, width: 40, height: 20 },
      { width: 300, height: 100 },
      { viewport, padding: 8 },
    );
    expect(r.left).toBeLessThanOrEqual(1000 - 300 - 8);
    expect(r.left).toBeGreaterThanOrEqual(8);
  });

  it('bottom（置中）會對齊錨點中心', () => {
    const r = positionFloating(
      { top: 100, bottom: 120, left: 400, right: 500, width: 100, height: 20 },
      { width: 200, height: 40 },
      { viewport, placement: 'bottom' },
    );
    expect(r.left).toBe(350);
  });

  it('pointRect 產生 0x0 的錨點（右鍵選單用）', () => {
    expect(pointRect(10, 20)).toEqual({ top: 20, left: 10, right: 10, bottom: 20, width: 0, height: 0 });
  });
});

describe('拖放落點計算', () => {
  const rects: BlockRect[] = [
    { id: 'a', top: 0, bottom: 40, left: 100, right: 700, depth: 0, canHaveChildren: true, inColumn: false },
    { id: 'b', top: 40, bottom: 80, left: 100, right: 700, depth: 0, canHaveChildren: true, inColumn: false },
    { id: 'c', top: 80, bottom: 120, left: 100, right: 700, depth: 0, canHaveChildren: false, inColumn: false },
  ];

  it('上半 → before，下半 → after', () => {
    expect(computeDropTarget(rects, 300, 10, { allowColumns: false })).toEqual({ id: 'a', position: 'before' });
    expect(computeDropTarget(rects, 110, 35, { allowColumns: false })).toEqual({ id: 'a', position: 'after' });
  });

  it('X 偏移超過門檻且目標支援 children → 縮排成子層', () => {
    expect(computeDropTarget(rects, 140, 75, { allowColumns: false })).toEqual({ id: 'b', position: 'child' });
    // 目標不支援 children 就退回 after
    expect(computeDropTarget(rects, 140, 115, { allowColumns: false })).toEqual({ id: 'c', position: 'after' });
  });

  it('拖到左 / 右邊緣帶 → 成為新欄', () => {
    expect(computeDropTarget(rects, 690, 20)).toEqual({ id: 'a', position: 'column-right' });
    expect(computeDropTarget(rects, 110, 20)).toEqual({ id: 'a', position: 'column-left' });
  });

  // 第四輪 BUG-14：只看 X 的話，「拖到上下邊界換順序」全部會被吃成「開一欄」
  it('靠左 / 右邊緣但貼在上下邊界 → 還是排序，不是開欄', () => {
    // block a 的範圍是 0–40，中間帶是 10–30
    expect(computeDropTarget(rects, 110, 2)).toEqual({ id: 'a', position: 'before' });
    expect(computeDropTarget(rects, 690, 2)).toEqual({ id: 'a', position: 'before' });
    expect(computeDropTarget(rects, 110, 38)).toEqual({ id: 'a', position: 'after' });
    // 右下角落在縮排區（舊行為），重點是「不再是 column-right」
    expect(computeDropTarget(rects, 690, 38)).toEqual({ id: 'a', position: 'child' });
    // 中間帶裡面還是要開欄
    expect(computeDropTarget(rects, 110, 20)).toEqual({ id: 'a', position: 'column-left' });
  });

  it('已經在欄裡就不再允許建立欄', () => {
    const inColumn = rects.map((r) => ({ ...r, inColumn: true }));
    expect(computeDropTarget(inColumn, 690, 20)?.position).not.toBe('column-right');
  });

  it('禁止落在自己與自己的子孫上', () => {
    const forbidden = new Set(['a', 'b']);
    expect(computeDropTarget(rects, 300, 10, { forbidden, allowColumns: false })?.id).toBe('c');
  });

  it('拖到所有 block 之上 / 之下會夾到頭尾', () => {
    expect(computeDropTarget(rects, 300, -50, { allowColumns: false })).toEqual({ id: 'a', position: 'before' });
    expect(computeDropTarget(rects, 300, 500, { allowColumns: false })).toEqual({ id: 'c', position: 'after' });
  });

  it('沒有候選時回 null', () => {
    expect(computeDropTarget([], 0, 0)).toBeNull();
    expect(computeDropTarget(rects, 0, 0, { forbidden: new Set(['a', 'b', 'c']) })).toBeNull();
  });

  it('indicator 幾何：before 畫在上緣、child 往內縮、欄位是直線', () => {
    const rect = rects[0] as BlockRect;
    expect(indicatorGeometry(rect, 'before')).toMatchObject({ top: 0, left: 100, height: 2, vertical: false });
    expect(indicatorGeometry(rect, 'after')).toMatchObject({ top: 40 });
    expect(indicatorGeometry(rect, 'child', 24)).toMatchObject({ left: 124, width: 576 });
    expect(indicatorGeometry(rect, 'column-right')).toMatchObject({ vertical: true, width: 2 });
  });

  it('自動捲動速度：靠近上下緣才作用', () => {
    expect(autoScrollSpeed(400, 800)).toBe(0);
    expect(autoScrollSpeed(10, 800)).toBeLessThan(0);
    expect(autoScrollSpeed(795, 800)).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════
   第五輪：貼上 Markdown 表格 / 純 URL、mention 的「@@」修補
   ═══════════════════════════════════════════════════════════ */

describe('貼上補丁（第五輪 §3）', () => {
  it('標準 GFM 表格解析得出來，短列會補齊成表頭的欄數', () => {
    const rows = parseMarkdownTable('| 欄一 | 欄二 |\n| --- | --- |\n| a1 | b1 |\n| a2 |');
    expect(rows).toEqual([
      ['欄一', '欄二'],
      ['a1', 'b1'],
      ['a2', ''],
    ]);
  });

  it('對齊語法（:--: / --: ）也算分隔列', () => {
    expect(parseMarkdownTable('| a | b |\n|:--:|---:|\n| 1 | 2 |')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('沒有分隔列就不接手 —— 那多半是使用者正在打字，不該偷偷變成表格', () => {
    expect(parseMarkdownTable('| 欄一 | 欄二 |\n| a1 | b1 |')).toBeNull();
    expect(parseMarkdownTable('一般文字')).toBeNull();
    expect(parseMarkdownTable('| 只有一欄 |\n| --- |')).toBeNull();
  });

  it('tableOps 生出 table + 每列一個 tableRow，cells 是 RichText 陣列', () => {
    const ops = tableOps(
      [
        ['h1', 'h2'],
        ['v1', ''],
      ],
      { table: 't', rows: ['r0', 'r1'] },
      null,
      'anchor',
    );
    expect(ops[0]).toMatchObject({ type: 'block.insert', blockId: 't', blockType: 'table', afterId: 'anchor' });
    expect((ops[0] as unknown as { props: Record<string, unknown> }).props).toMatchObject({ columnCount: 2 });
    expect(ops[1]).toMatchObject({ blockId: 'r0', parentId: 't', blockType: 'tableRow', afterId: null });
    expect((ops[1] as unknown as { props: { cells: unknown } }).props.cells).toEqual([[{ text: 'h1' }], [{ text: 'h2' }]]);
    // 空白儲存格是空陣列，不是 [{ text: '' }]（normalize 會把空字串丟掉）
    expect((ops[2] as unknown as { props: { cells: unknown } }).props.cells).toEqual([[{ text: 'v1' }], []]);
  });

  it('只有「整段就是一條 http(s) 網址」才當成連結', () => {
    expect(bareUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(bareUrl('  http://example.com  ')).toBe('http://example.com');
    expect(bareUrl('看這個 https://example.com')).toBeNull();
    expect(bareUrl('https://a.com\nhttps://b.com')).toBeNull();
    expect(bareUrl('javascript:alert(1)')).toBeNull();
    expect(bareUrl('example.com')).toBeNull();
  });

  it('linkRichText 產生帶 link mark 的一段文字', () => {
    expect(linkRichText('https://example.com')).toEqual([
      { text: 'https://example.com', marks: [{ t: 'link', href: 'https://example.com' }] },
    ]);
  });
});

describe('mention 顯示（第四輪 BUG-15 的殘留資料）', () => {
  it('舊資料 text 裡已經有 @ 時，渲染只留一個', () => {
    expect(hostAtomText({ atom: 'mention', data: { text: '@訪客' } })).toBe('@訪客');
    expect(hostAtomText({ atom: 'mention', data: { text: '訪客' } })).toBe('@訪客');
  });

  it('其他 atom 不受影響', () => {
    expect(hostAtomText({ atom: 'date', data: { iso: '2026-09-20' } })).toBe('2026-09-20');
    expect(hostAtomText({ atom: 'pageLink', data: { title: '@工作區' } })).toBe('@工作區');
  });
});
