import { describe, expect, it } from 'vitest';
import {
  allSlashCommands,
  BLOCK_BACKGROUNDS,
  BLOCK_COLORS,
  COMMAND_GROUP_ORDER,
  groupCommands,
  searchCommands,
} from '../menus/slashCommands';

const ALL = allSlashCommands();

describe('slash 指令表', () => {
  it('涵蓋規格要求的所有分組：基本 / 媒體 / 資料庫 / 進階 / 嵌入 / 行內 / 顏色 / 背景色', () => {
    const groups = new Set(ALL.map((c) => c.group));
    for (const g of COMMAND_GROUP_ORDER) {
      expect(groups.has(g), `缺少分組 ${g}`).toBe(true);
    }
  });

  it('id 不重複', () => {
    const ids = ALL.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
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
  });
});

describe('searchCommands', () => {
  it('空查詢顯示全部', () => {
    expect(searchCommands('')).toHaveLength(ALL.length);
  });

  it.each([
    ['code', 'block:code'],
    ['代碼', 'block:code'],
    ['程式碼', 'block:code'],
    ['h1', 'block:heading1'],
    ['標題', 'block:heading1'],
    ['待辦', 'block:todo'],
    ['圖片', 'block:image'],
    ['資料庫', 'block:collectionView'],
    ['目錄', 'block:tableOfContents'],
    ['公式', 'block:equation'],
    ['分欄', 'columns:2'],
    ['日期', 'inline:date'],
    ['提及', 'inline:mention'],
  ])('「%s」的第一名是 %s', (query, id) => {
    expect(searchCommands(query)[0]?.id).toBe(id);
  });

  it('顏色指令搜得到', () => {
    const red = searchCommands('紅色');
    expect(red[0]?.id).toBe('color:red');
    const bg = searchCommands('背景');
    expect(bg.every((c) => c.group === 'background')).toBe(true);
  });

  it('無結果時回空陣列', () => {
    expect(searchCommands('ZZZZ不存在')).toEqual([]);
  });

  it('大小寫不敏感', () => {
    expect(searchCommands('CODE')[0]?.id).toBe('block:code');
    expect(searchCommands('Image')[0]?.id).toBe('block:image');
  });
});

describe('groupCommands', () => {
  it('依 COMMAND_GROUP_ORDER 分節，且不遺漏任何項目', () => {
    const items = searchCommands('');
    const groups = groupCommands(items);
    const flat = groups.flatMap((g) => g.items);
    expect(flat).toHaveLength(items.length);

    const order = groups.map((g) => g.group);
    const expectedOrder = COMMAND_GROUP_ORDER.filter((g) => order.includes(g));
    expect(order).toEqual(expectedOrder);
  });

  it('搜尋結果也會分節', () => {
    const groups = groupCommands(searchCommands('清單'));
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0]?.items.length).toBeGreaterThan(0);
  });
});
