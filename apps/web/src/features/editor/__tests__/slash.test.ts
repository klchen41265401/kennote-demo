import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allSlashCommands,
  BLOCK_BACKGROUNDS,
  BLOCK_COLORS,
  COMMAND_GROUP_LABELS,
  COMMAND_GROUP_ORDER,
  groupCommands,
  searchCommands,
  type CommandGroup,
} from '../menus/slashCommands';
import { missingPinyinChars, pinyinInitials } from '../lib/pinyin';

const ALL = allSlashCommands();

/* ──────────────────────────────────────────────────────────
   真值：reference/notion-capture/_slash-menu-full.json
   （實機把 Notion 7.34 的整個 `/` 選單捲完抓下來的 164 項）
   ────────────────────────────────────────────────────────── */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAPTURE = path.resolve(HERE, '../../../../../../reference/notion-capture/_slash-menu-full.json');

interface CapturedItem {
  label: string;
  hint?: string;
}

function loadCapture(): CapturedItem[] {
  const raw = JSON.parse(readFileSync(CAPTURE, 'utf8')) as { items: { t: string }[] };
  return raw.items.map(({ t }) => {
    const parts = t.split(' | ');
    // 顏色項目的 icon 是文字「A」，不是名稱
    if (parts[0] === 'A') parts.shift();
    const cleaned: string[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] as string;
      // 「·」後面接的是分組名（例如 `HTML · 嵌入區塊`），不是項目名稱
      if (part === '·') {
        i += 1;
        continue;
      }
      // 「新」是徽章
      if (part === '新') continue;
      cleaned.push(part);
    }
    const item: CapturedItem = { label: cleaned[0] as string };
    if (cleaned[1] !== undefined) item.hint = cleaned[1];
    return item;
  });
}

const CAPTURED = loadCapture();

describe('與真實 Notion 7.34 的 `/` 選單逐項對照', () => {
  it('抓到的項目數就是 164（UI-SPEC §6.1）', () => {
    expect(CAPTURED).toHaveLength(164);
  });

  it('kennote 的指令表項目數與 Notion 完全相同', () => {
    expect(ALL).toHaveLength(CAPTURED.length);
  });

  it('每一項的「名稱 + 右側提示 + 順序」都與 Notion 一致', () => {
    const mine = ALL.map((c) => (c.hint ? `${c.label} | ${c.hint}` : c.label));
    const theirs = CAPTURED.map((c) => (c.hint ? `${c.label} | ${c.hint}` : c.label));
    expect(mine).toEqual(theirs);
  });

  it('沒有漏掉任何 Notion 項目（逐一檢查，錯的時候看得出是哪一個）', () => {
    const missing: string[] = [];
    for (const item of CAPTURED) {
      if (!ALL.some((c) => c.label === item.label)) missing.push(item.label);
    }
    expect(missing).toEqual([]);
  });

  it('分組順序與 Notion 相同，且每一組都是連續的一段', () => {
    const seen: CommandGroup[] = [];
    for (const command of ALL) {
      if (seen[seen.length - 1] !== command.group) seen.push(command.group);
    }
    // 每個分組只會出現一次 → 連續
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(COMMAND_GROUP_ORDER.filter((g) => seen.includes(g)));
    expect(seen.map((g) => COMMAND_GROUP_LABELS[g])).toEqual([
      '建議',
      '基本區塊',
      '媒體',
      '資料庫',
      '進階區塊',
      '行內',
      '嵌入',
      '匯入',
      '轉換成',
      '動作',
      '文字顏色',
      '背景顏色',
    ]);
  });

  it('各分組的項目數與 Notion 一致', () => {
    const count = (group: CommandGroup): number => ALL.filter((c) => c.group === group).length;
    expect(count('suggested')).toBe(4);
    expect(count('basic')).toBe(14);
    expect(count('media')).toBe(5);
    expect(count('database')).toBe(18);
    expect(count('advanced')).toBe(15);
    expect(count('inline')).toBe(5);
    expect(count('embed')).toBe(53);
    expect(count('import')).toBe(11);
    expect(count('turnInto')).toBe(14);
    expect(count('actions')).toBe(5);
    expect(count('color')).toBe(10);
    expect(count('background')).toBe(10);
  });

  it('markdown 縮寫提示與 Notion 相同', () => {
    const hint = (label: string): string | undefined => ALL.find((c) => c.label === label)?.hint;
    expect(hint('標題 1')).toBe('#');
    expect(hint('標題 4')).toBe('####');
    expect(hint('項目符號列表')).toBe('-');
    expect(hint('編號列表')).toBe('1.');
    expect(hint('待辦清單')).toBe('[]');
    expect(hint('摺疊列表')).toBe('>');
    expect(hint('引用')).toBe('"');
    expect(hint('分隔線')).toBe('---');
    expect(hint('程式碼')).toBe('```');
    expect(hint('摺疊標題 1')).toBe('# >');
    expect(hint('複製區塊連結')).toBe('Alt+⇧+L');
  });

  it('「新」徽章掛在 Notion 標「新」的那幾項上', () => {
    const badged = ALL.filter((c) => c.badge === '新').map((c) => c.label);
    expect(badged).toContain('HTML');
    expect(badged).toContain('儀表板瀏覽模式');
    expect(badged).toContain('分頁');
    expect(badged).toContain('Google 文件');
  });
});

describe('slash 指令表的基本健全性', () => {
  it('id 不重複', () => {
    const ids = ALL.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('sortOrder 嚴格遞增（選單順序才穩定）', () => {
    for (let i = 1; i < ALL.length; i += 1) {
      expect(ALL[i]!.sortOrder).toBeGreaterThan(ALL[i - 1]!.sortOrder);
    }
  });

  it('顏色 / 背景色各 10 項（預設 + 9 色）', () => {
    expect(ALL.filter((c) => c.group === 'color')).toHaveLength(BLOCK_COLORS.length);
    expect(ALL.filter((c) => c.group === 'background')).toHaveLength(BLOCK_BACKGROUNDS.length);
  });

  it('不列出只由結構操作產生的型別', () => {
    expect(ALL.some((c) => c.id === 'block:column')).toBe(false);
    expect(ALL.some((c) => c.id === 'block:tableRow')).toBe(false);
    expect(ALL.some((c) => c.id === 'block:columnList')).toBe(false);
    expect(ALL.some((c) => c.id === 'columns:2')).toBe(true);
    expect(ALL.some((c) => c.id === 'columns:5')).toBe(true);
  });

  it('每個項目都有可執行的 action（沒有半途而廢的項目）', () => {
    for (const command of ALL) {
      expect(command.action, `${command.label} 沒有 action`).toBeTruthy();
      // 佔位項目一定要有徽章（「即將推出」，或 Notion 自己標的「新」），使用者才不會白點
      if (command.action.kind === 'soon') {
        expect(command.badge, `${command.label} 是佔位但沒有徽章`).toBeDefined();
      }
    }
  });

  it('佔位（即將推出）的項目只有 AI 與尚未支援的資料庫瀏覽模式', () => {
    const soon = ALL.filter((c) => c.action.kind === 'soon').map((c) => c.label);
    expect(soon.sort()).toEqual(
      [
        'AI 區塊',
        'AI 筆記寫手',
        '分頁',
        '儀表板瀏覽模式',
        '動態瀏覽模式',
        '地圖瀏覽模式',
        '垂直長條圖',
        '折線圖',
        '數字圖表',
        '時間軸瀏覽模式',
        '水平長條圖',
        '環形圖',
        '表單',
        '萬事問 AI',
      ].sort(),
    );
  });
});

describe('searchCommands', () => {
  it('空查詢顯示全部', () => {
    expect(searchCommands('')).toHaveLength(ALL.length);
  });

  it('目前 block 是空的時候不顯示「轉換成」（Notion 行為）', () => {
    const result = searchCommands('', undefined, { blockHasContent: false });
    expect(result.some((c) => c.group === 'turnInto')).toBe(false);
    expect(result).toHaveLength(ALL.length - 14);
  });

  it.each([
    ['code', 'block:code'],
    ['代碼', 'block:code'],
    ['程式碼', 'block:code'],
    ['h1', 'block:heading1'],
    ['標題 1', 'block:heading1'],
    ['標題1', 'block:heading1'],
    ['待辦', 'block:todo'],
    ['圖片', 'block:image'],
    ['音訊', 'block:audio'],
    ['目錄', 'block:tableOfContents'],
    ['按鈕', 'block:button'],
    ['頁面路徑', 'block:breadcrumb'],
    ['同步', 'block:syncedBlock'],
    ['摺疊標題 1', 'toggleHeading:1'],
    ['2 欄', 'columns:2'],
    ['figma', 'embed:figma'],
    ['github', 'embed:github'],
    ['gist', 'embed:githubGist'],
    ['csv', 'import:csv'],
    ['提及人員', 'inline:mention'],
    ['表情符號', 'inline:emoji'],
  ])('「%s」的第一名是 %s', (query, id) => {
    expect(searchCommands(query)[0]?.id).toBe(id);
  });

  it('拼音首字母也搜得到（/cs = 程式碼、/mlu = 目錄…）', () => {
    expect(pinyinInitials('程式碼')).toBe('csm');
    expect(searchCommands('csm')[0]?.label).toBe('程式碼');
    expect(searchCommands('ml')[0]?.label).toBe('目錄');
    expect(searchCommands('zlk').some((c) => c.label.includes('資料庫'))).toBe(true);
  });

  it('所有中文標籤的字都在拼音表裡（缺字會讓拼音搜尋悄悄失效）', () => {
    const missing = new Set<string>();
    for (const command of ALL) {
      for (const char of missingPinyinChars(command.label)) missing.add(char);
    }
    expect([...missing]).toEqual([]);
  });

  it('顏色指令搜得到', () => {
    expect(searchCommands('紅色文字')[0]?.id).toBe('color:red');
    expect(searchCommands('背景').every((c) => c.group === 'background')).toBe(true);
  });

  it('無結果時回空陣列', () => {
    expect(searchCommands('ZZZZ不存在')).toEqual([]);
  });

  it('大小寫不敏感', () => {
    expect(searchCommands('CODE')[0]?.id).toBe('block:code');
    expect(searchCommands('Image')[0]?.id).toBe('block:image');
  });

  it('最近用過的指令會浮到「建議」的最前面', () => {
    const result = searchCommands('', undefined, { recentIds: ['suggested:callout'] });
    expect(result[0]?.id).toBe('suggested:callout');
  });
});

describe('groupCommands', () => {
  it('依 COMMAND_GROUP_ORDER 分節，且不遺漏任何項目', () => {
    const items = searchCommands('');
    const groups = groupCommands(items);
    const flat = groups.flatMap((g) => g.items);
    expect(flat).toHaveLength(items.length);

    const order = groups.map((g) => g.group);
    expect(order).toEqual(COMMAND_GROUP_ORDER.filter((g) => order.includes(g)));
  });

  it('搜尋結果也會分節', () => {
    const groups = groupCommands(searchCommands('列表'));
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0]?.items.length).toBeGreaterThan(0);
  });
});
