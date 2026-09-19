/**
 * Notion 官方匯出 zip 的結構解析 + 伺服器端 HTML 解析。
 * 全部是純邏輯，**沒有資料庫也跑得動**（04 §9 的原則）。
 *
 * fixture：test/fixtures/notion-export.zip（由 make-notion-fixture.ts 產生，
 * 含 2 層頁面 + 1 個 CSV database + 1 張圖）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ZipArchive } from '../src/modules/export/zip.js';
import { parseCsv, planCsvSchema } from '../src/modules/import/csv.js';
import { markdownToFragment } from '../src/modules/import/markdown.js';
import { htmlToBlocks, decodeEntities, parseHtml, safeHref } from '../src/modules/import/mini-html.js';
import {
  createLinkResolver,
  notionIdFromUrl,
  parseNotionName,
  planNotionImport,
  resolveRelative,
  stripCommonRoot,
  type NotionNode,
} from '../src/modules/import/notion.js';
import { detectSource, fragmentToOps } from '../src/modules/import/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(path.join(here, 'fixtures', 'notion-export.zip'));

let counter = 0;
const nextId = (): string => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('檔名解析', () => {
  it('去掉 32 碼 hex 的頁面 id', () => {
    expect(parseNotionName('專案筆記 1a2b3c4d5e6f78901234567890abcdef')).toEqual({
      title: '專案筆記',
      notionId: '1a2b3c4d5e6f78901234567890abcdef',
    });
  });

  it('新版匯出的帶 dash 形式也認得', () => {
    expect(parseNotionName('Page 1a2b3c4d-5e6f-7890-1234-567890abcdef').notionId).toBe(
      '1a2b3c4d5e6f78901234567890abcdef',
    );
  });

  it('沒有 hex 就整串當標題', () => {
    expect(parseNotionName('我的筆記')).toEqual({ title: '我的筆記', notionId: null });
  });

  it('stripCommonRoot 剝掉 Export-xxx/ 那一層', () => {
    const { paths, stripped } = stripCommonRoot(['Export-1/a.md', 'Export-1/b/c.md']);
    expect(paths).toEqual(['a.md', 'b/c.md']);
    expect(stripped).toBe('Export-1/');
  });

  it('沒有共同根目錄時不亂剝', () => {
    expect(stripCommonRoot(['a.md', 'b/c.md']).paths).toEqual(['a.md', 'b/c.md']);
  });

  it('notionIdFromUrl 從 notion.so 連結取 id', () => {
    expect(notionIdFromUrl('https://www.notion.so/Some-Page-1a2b3c4d5e6f78901234567890abcdef')).toBe(
      '1a2b3c4d5e6f78901234567890abcdef',
    );
  });

  it('resolveRelative 處理 ../', () => {
    expect(resolveRelative('A/B/C.md', '../D.md')).toBe('A/D.md');
    expect(resolveRelative('A.md', 'A/B.md')).toBe('A/B.md');
  });
});

describe('planNotionImport（用真的 fixture zip）', () => {
  const archive = ZipArchive.open(FIXTURE);
  const names = archive.entries().filter((e) => !e.isDirectory).map((e) => e.name);
  const plan = planNotionImport(names);

  it('辨識成 Markdown 匯出，並剝掉共同根目錄', () => {
    expect(plan.format).toBe('markdown');
    expect(plan.prefix).toMatch(/^Export-/);
  });

  it('頁面層級：1 個根頁面 → 1 個子頁面 + 1 個 database', () => {
    expect(plan.roots).toHaveLength(1);
    const root = plan.roots[0]!;
    expect(root.kind).toBe('page');
    expect(root.title).toBe('專案筆記');
    expect(root.children.map((c) => `${c.kind}:${c.title}`).sort()).toEqual([
      'database:任務清單',
      'page:會議紀錄',
    ]);
  });

  it('database 優先用 `_all.csv`（未套用視圖篩選的完整資料）', () => {
    const database = plan.roots[0]!.children.find((c) => c.kind === 'database')!;
    expect(database.csvPath).toMatch(/_all\.csv$/);
  });

  it('圖片被歸類成附件', () => {
    expect(plan.assets.map((a) => a.name)).toEqual(['screenshot.png']);
  });

  it('pageCount 只算頁面，不算 database', () => {
    expect(plan.pageCount).toBe(2);
  });

  it('連結解析：子頁面的相對連結對得到新 pageId', () => {
    const ids = new Map<NotionNode, string>();
    ids.set(plan.roots[0]!, 'page-root');
    for (const child of plan.roots[0]!.children) ids.set(child, `page-${child.title}`);
    const resolve = createLinkResolver(plan, (node) => ids.get(node));

    const root = plan.roots[0]!;
    const child = root.children.find((c) => c.kind === 'page')!;
    const href = encodeURI(child.docPath!.slice(root.dir.length + 1));
    expect(resolve(`${encodeURI(root.dir)}/${href}`, root.docPath!)).toBe('page-會議紀錄');
  });

  it('不認得的連結回 null（保持原樣，不亂改）', () => {
    const resolve = createLinkResolver(plan, () => 'x');
    expect(resolve('https://example.com', plan.roots[0]!.docPath!)).toBeNull();
  });
});

describe('fixture 的內容解析', () => {
  const archive = ZipArchive.open(FIXTURE);
  const entryOf = (suffix: string) => archive.entries().find((e) => e.name.endsWith(suffix))!;

  it('根頁面的 Markdown：標題抽出來、待辦與圖片都在', () => {
    const md = archive.readText(entryOf('專案筆記 1a2b3c4d5e6f78901234567890abcdef.md'));
    const parsed = markdownToFragment(md, nextId);
    expect(parsed.title).toBe('專案筆記');
    const types = parsed.rootIds.map((id) => parsed.blocks[id]!.type);
    expect(types).toContain('heading2');
    expect(types).toContain('todo');
    expect(types).toContain('image');
    const todos = Object.values(parsed.blocks).filter((b) => b.type === 'todo');
    expect(todos.map((t) => t.props.checked).sort()).toEqual([false, true]);
  });

  it('子頁面的 Markdown：引言 + 編號清單 + 程式碼', () => {
    const md = archive.readText(entryOf('9f8e7d6c5b4a39281706f5e4d3c2b1a0.md'));
    const parsed = markdownToFragment(md, nextId);
    expect(parsed.title).toBe('會議紀錄');
    const types = parsed.rootIds.map((id) => parsed.blocks[id]!.type);
    expect(types).toEqual(['quote', 'numberedList', 'numberedList', 'code']);
    const code = Object.values(parsed.blocks).find((b) => b.type === 'code')!;
    expect(code.props.language).toBe('sql');
  });

  it('CSV → schema：欄位型別對應正確', () => {
    const csv = archive.readText(entryOf('_all.csv'));
    const plan = planCsvSchema(parseCsv(csv));
    const byName = Object.fromEntries(plan.columns.map((c) => [c.name, c.type]));
    expect(byName['名稱']).toBe('title');
    expect(byName['狀態']).toBe('select');
    expect(byName['截止日']).toBe('date');
    expect(byName['完成']).toBe('checkbox');
    expect(byName['連結']).toBe('url');
    expect(byName['預估工時']).toBe('number');
  });

  it('圖片是真的 PNG（magic number 過得了 files 模組的驗證）', () => {
    const png = archive.read(entryOf('screenshot.png'));
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});

describe('detectSource', () => {
  it('依副檔名判斷', () => {
    expect(detectSource('a.zip', Buffer.alloc(0))).toBe('notionZip');
    expect(detectSource('a.csv', Buffer.alloc(0))).toBe('csv');
    expect(detectSource('a.md', Buffer.alloc(0))).toBe('markdown');
    expect(detectSource('a.html', Buffer.alloc(0))).toBe('html');
    expect(detectSource('a.txt', Buffer.alloc(0))).toBe('text');
  });

  it('沒有副檔名時看內容', () => {
    expect(detectSource('blob', FIXTURE)).toBe('notionZip');
    expect(detectSource('blob', Buffer.from('<!DOCTYPE html><html>'))).toBe('html');
  });
});

describe('fragmentToOps —— 匯入一律走 applyTransaction', () => {
  it('前序展開，afterId 串成一條鏈', () => {
    const parsed = markdownToFragment('- a\n  - a1\n- b\n', nextId, { extractTitle: false });
    const ops = fragmentToOps(parsed, null);
    expect(ops.every((op) => op.type === 'block.insert')).toBe(true);

    const inserts = ops as Array<{ blockId: string; parentId: string | null; afterId: string | null }>;
    expect(inserts[0]!.parentId).toBeNull();
    expect(inserts[0]!.afterId).toBeNull();
    // 第二個是 a 的子項
    expect(inserts[1]!.parentId).toBe(inserts[0]!.blockId);
    expect(inserts[1]!.afterId).toBeNull();
    // 第三個回到根層，排在 a 後面
    expect(inserts[2]!.parentId).toBeNull();
    expect(inserts[2]!.afterId).toBe(inserts[0]!.blockId);
  });

  it('第一個 block 可以接在既有的 placeholder 之後', () => {
    const parsed = markdownToFragment('hello', nextId, { extractTitle: false });
    const ops = fragmentToOps(parsed, 'placeholder-id') as Array<{ afterId: string | null }>;
    expect(ops[0]!.afterId).toBe('placeholder-id');
  });
});

/* ── 伺服器端 HTML 解析（Notion 的 HTML 匯出） ───────── */

describe('mini-html', () => {
  it('tokenizer：巢狀、自閉合、屬性、註解', () => {
    const root = parseHtml('<div class="a"><p>x<br/>y</p><!-- c --></div>');
    const div = root.children[0]!;
    expect(div.type === 'element' && div.tag).toBe('div');
    expect(div.type === 'element' && div.attrs['class']).toBe('a');
  });

  it('decodeEntities 處理具名與數值實體', () => {
    expect(decodeEntities('a&amp;b&lt;c&gt;d&#39;e&#x4E2D;')).toBe("a&b<c>d'e中");
  });

  it('safeHref 擋掉 javascript: 與 data:', () => {
    expect(safeHref('javascript:alert(1)')).toBe('');
    expect(safeHref('data:text/html,x')).toBe('');
    expect(safeHref('https://a.com')).toBe('https://a.com');
    expect(safeHref('../b/c.html')).toBe('../b/c.html');
  });

  it('Notion HTML 匯出的結構：標題、待辦、callout、程式碼、表格', () => {
    const html = `<!DOCTYPE html><html><head><title>專案筆記</title></head><body>
      <article class="page sans"><header><h1 class="page-title">專案筆記</h1></header>
      <div class="page-body">
        <h2 class="header">章節</h2>
        <p>一段<strong>粗體</strong>文字</p>
        <ul class="to-do-list"><li><div class="checkbox checkbox-on"></div><span>做完了</span></li>
          <li><div class="checkbox checkbox-off"></div><span>還沒做</span></li></ul>
        <figure class="callout"><div class="callout-icon">⚠️</div><div class="callout-body">小心</div></figure>
        <pre class="code"><code class="language-ts">const a = 1;</code></pre>
        <table class="collection-content"><tbody><tr><th>欄一</th><th>欄二</th></tr>
          <tr><td>a</td><td>b</td></tr></tbody></table>
        <ul class="bulleted-list"><li>外層<ul class="bulleted-list"><li>內層</li></ul></li></ul>
      </div></article></body></html>`;

    const result = htmlToBlocks(html, nextId);
    expect(result.title).toBe('專案筆記');
    const types = result.rootIds.map((id) => result.blocks[id]!.type);
    expect(types).toEqual([
      'heading2',
      'paragraph',
      'todo',
      'todo',
      'callout',
      'code',
      'table',
      'bulletedList',
    ]);

    const todos = result.rootIds
      .map((id) => result.blocks[id]!)
      .filter((b) => b.type === 'todo');
    expect(todos.map((t) => t.props.checked)).toEqual([true, false]);

    const callout = result.rootIds.map((id) => result.blocks[id]!).find((b) => b.type === 'callout')!;
    expect(callout.props.icon).toBe('⚠️');

    const code = result.rootIds.map((id) => result.blocks[id]!).find((b) => b.type === 'code')!;
    expect(code.props.language).toBe('ts');

    const table = result.rootIds.map((id) => result.blocks[id]!).find((b) => b.type === 'table')!;
    expect(table.props.columnCount).toBe(2);
    expect(table.props.hasColumnHeader).toBe(true);
    expect(table.children).toHaveLength(2);

    const list = result.rootIds.map((id) => result.blocks[id]!).find((b) => b.type === 'bulletedList')!;
    expect(list.children).toHaveLength(1);
    expect(result.blocks[list.children[0]!]!.type).toBe('bulletedList');
  });

  it('圖片 figure → image block（src 之後由匯入服務換成 fileId）', () => {
    const result = htmlToBlocks(
      '<figure class="image"><img src="page/screenshot.png" alt="截圖"/><figcaption>說明</figcaption></figure>',
      nextId,
    );
    const image = result.blocks[result.rootIds[0]!]!;
    expect(image.type).toBe('image');
    expect(image.props.externalUrl).toBe('page/screenshot.png');
    expect(image.props.altText).toBe('截圖');
  });

  it('<details> → toggle，內容變成子層', () => {
    const result = htmlToBlocks('<details><summary>展開</summary><p>內容</p></details>', nextId);
    const toggle = result.blocks[result.rootIds[0]!]!;
    expect(toggle.type).toBe('toggle');
    expect(toggle.children).toHaveLength(1);
    expect(result.blocks[toggle.children[0]!]!.type).toBe('paragraph');
  });

  it('script / style 一律丟棄', () => {
    const result = htmlToBlocks('<body><script>alert(1)</script><style>p{}</style><p>安全</p></body>', nextId);
    const texts = result.rootIds.map((id) => {
      const block = result.blocks[id]!;
      return block.content.map((n) => ('text' in n ? n.text : '')).join('');
    });
    expect(texts).toEqual(['安全']);
  });
});
