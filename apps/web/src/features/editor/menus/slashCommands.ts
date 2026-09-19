/**
 * Slash menu 的指令表（02 §4.1.1）。
 *
 * 分組：基本區塊 / 媒體 / 資料庫 / 進階 / 嵌入 / 行內 / 顏色 / 背景色。
 * 區塊型別的部分直接讀前端 Block Registry（`blocks/registry.ts`），
 * 所以新增 block type 不需要改這支檔案。
 */
import type { BlockType } from '@kennote/shared-types';
import { GROUP_LABELS, listSpecs, scoreSpec, type BlockSpec, type SlashGroup } from '../blocks/registry';
import type { IconName } from '../ui/icons';

export type CommandGroup = SlashGroup | 'inline' | 'color' | 'background';

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  ...GROUP_LABELS,
  inline: '行內',
  color: '文字顏色',
  background: '背景色',
};

export const COMMAND_GROUP_ORDER: CommandGroup[] = [
  'basic',
  'media',
  'database',
  'advanced',
  'embed',
  'inline',
  'color',
  'background',
];

/** 03 §6.2 的 block_color 語彙 */
export const BLOCK_COLORS: { id: string; label: string; cssVar: string | null }[] = [
  { id: 'default', label: '預設', cssVar: null },
  { id: 'gray', label: '灰色', cssVar: '--kn-color-block-gray' },
  { id: 'brown', label: '棕色', cssVar: '--kn-color-block-brown' },
  { id: 'orange', label: '橘色', cssVar: '--kn-color-block-orange' },
  { id: 'yellow', label: '黃色', cssVar: '--kn-color-block-yellow' },
  { id: 'green', label: '綠色', cssVar: '--kn-color-block-green' },
  { id: 'blue', label: '藍色', cssVar: '--kn-color-block-blue' },
  { id: 'purple', label: '紫色', cssVar: '--kn-color-block-purple' },
  { id: 'pink', label: '粉紅色', cssVar: '--kn-color-block-pink' },
  { id: 'red', label: '紅色', cssVar: '--kn-color-block-red' },
];

export const BLOCK_BACKGROUNDS: { id: string; label: string; cssVar: string | null }[] = [
  { id: 'default', label: '預設背景', cssVar: null },
  { id: 'gray_background', label: '灰色背景', cssVar: '--kn-color-block-gray-bg' },
  { id: 'brown_background', label: '棕色背景', cssVar: '--kn-color-block-brown-bg' },
  { id: 'orange_background', label: '橘色背景', cssVar: '--kn-color-block-orange-bg' },
  { id: 'yellow_background', label: '黃色背景', cssVar: '--kn-color-block-yellow-bg' },
  { id: 'green_background', label: '綠色背景', cssVar: '--kn-color-block-green-bg' },
  { id: 'blue_background', label: '藍色背景', cssVar: '--kn-color-block-blue-bg' },
  { id: 'purple_background', label: '紫色背景', cssVar: '--kn-color-block-purple-bg' },
  { id: 'pink_background', label: '粉紅色背景', cssVar: '--kn-color-block-pink-bg' },
  { id: 'red_background', label: '紅色背景', cssVar: '--kn-color-block-red-bg' },
];

export type SlashAction =
  | { kind: 'block'; type: BlockType; mode: 'convert' | 'insert'; props?: Record<string, unknown> }
  | { kind: 'color'; color: string }
  | { kind: 'inline'; inline: 'mention' | 'pageLink' | 'date' | 'equation' | 'emoji' }
  | { kind: 'columns'; count: number };

export interface SlashCommand {
  id: string;
  group: CommandGroup;
  label: string;
  labelEn: string;
  description?: string;
  icon: IconName;
  keywords: string[];
  sortOrder: number;
  swatchVar?: string | null;
  action: SlashAction;
}

function fromSpec(spec: BlockSpec): SlashCommand {
  return {
    id: `block:${spec.type}`,
    group: spec.group,
    label: spec.label,
    labelEn: spec.labelEn,
    description: spec.description,
    icon: spec.icon,
    keywords: spec.keywords,
    sortOrder: spec.sortOrder,
    action: { kind: 'block', type: spec.type, mode: spec.insertMode, props: spec.defaultProps },
  };
}

const INLINE_COMMANDS: SlashCommand[] = [
  {
    id: 'inline:mention',
    group: 'inline',
    label: '提及人員',
    labelEn: 'Mention a person',
    description: '用 @ 提及工作區成員',
    icon: 'user',
    keywords: ['mention', 'person', 'people', 'user', '提及', '人員', '成員', '@'],
    sortOrder: 400,
    action: { kind: 'inline', inline: 'mention' },
  },
  {
    id: 'inline:pageLink',
    group: 'inline',
    label: '連結頁面',
    labelEn: 'Link to page',
    description: '插入指向其他頁面的行內連結',
    icon: 'page',
    keywords: ['link', 'page', 'mention', '連結', '頁面', '提及頁面', '[['],
    sortOrder: 410,
    action: { kind: 'inline', inline: 'pageLink' },
  },
  {
    id: 'inline:date',
    group: 'inline',
    label: '日期',
    labelEn: 'Date',
    description: '插入今天的日期',
    icon: 'calendar',
    keywords: ['date', 'today', 'time', 'reminder', '日期', '今天', '時間'],
    sortOrder: 420,
    action: { kind: 'inline', inline: 'date' },
  },
  {
    id: 'inline:equation',
    group: 'inline',
    label: '行內公式',
    labelEn: 'Inline equation',
    description: '在文字中插入 LaTeX 公式',
    icon: 'equation',
    keywords: ['equation', 'math', 'latex', '公式', '數學', '行內公式'],
    sortOrder: 430,
    action: { kind: 'inline', inline: 'equation' },
  },
  {
    id: 'inline:emoji',
    group: 'inline',
    label: 'Emoji',
    labelEn: 'Emoji',
    description: '插入表情符號',
    icon: 'sparkle',
    keywords: ['emoji', 'icon', 'smile', '表情', '符號'],
    sortOrder: 440,
    action: { kind: 'inline', inline: 'emoji' },
  },
];

const LAYOUT_COMMANDS: SlashCommand[] = [2, 3, 4].map((count, i) => ({
  id: `columns:${count}`,
  group: 'advanced' as CommandGroup,
  label: `${count} 欄版面`,
  labelEn: `${count} columns`,
  description: `把內容並排成 ${count} 欄`,
  icon: 'columns' as IconName,
  keywords: ['column', 'columns', 'layout', '多欄', '分欄', `${count}欄`],
  sortOrder: 281 + i,
  action: { kind: 'columns' as const, count },
}));

const COLOR_COMMANDS: SlashCommand[] = [
  ...BLOCK_COLORS.map((c, i) => ({
    id: `color:${c.id}`,
    group: 'color' as CommandGroup,
    label: c.label,
    labelEn: c.id,
    icon: 'palette' as IconName,
    keywords: ['color', 'text', c.id, '顏色', '文字色', c.label],
    sortOrder: 500 + i,
    swatchVar: c.cssVar,
    action: { kind: 'color' as const, color: c.id },
  })),
];

const BACKGROUND_COMMANDS: SlashCommand[] = [
  ...BLOCK_BACKGROUNDS.map((c, i) => ({
    id: `bg:${c.id}`,
    group: 'background' as CommandGroup,
    label: c.label,
    labelEn: c.id,
    icon: 'palette' as IconName,
    keywords: ['background', 'bg', c.id, '背景', '背景色', c.label],
    sortOrder: 600 + i,
    swatchVar: c.cssVar,
    action: { kind: 'color' as const, color: c.id },
  })),
];

/** slash menu 不列出的型別（只由結構操作產生） */
const HIDDEN: BlockType[] = ['column', 'tableRow'];

export function allSlashCommands(): SlashCommand[] {
  return [
    ...listSpecs()
      .filter((s) => !HIDDEN.includes(s.type) && s.type !== 'columnList')
      .map(fromSpec),
    ...LAYOUT_COMMANDS,
    ...INLINE_COMMANDS,
    ...COLOR_COMMANDS,
    ...BACKGROUND_COMMANDS,
  ].sort((a, b) => a.sortOrder - b.sortOrder);
}

function scoreCommand(command: SlashCommand, query: string): number {
  const q = query.trim().toLowerCase();
  if (q === '') return 100;
  const label = command.label.toLowerCase();
  const labelEn = command.labelEn.toLowerCase();
  if (label === q || labelEn === q) return 0;
  if (label.startsWith(q) || labelEn.startsWith(q)) return 1;
  const kws = command.keywords.map((k) => k.toLowerCase());
  if (kws.some((k) => k === q)) return 2;
  if (kws.some((k) => k.startsWith(q))) return 3;
  if (label.includes(q) || labelEn.includes(q)) return 4;
  if (kws.some((k) => k.includes(q))) return 5;
  return -1;
}

/**
 * 搜尋。空查詢時回傳全部（依分組排序）。
 * 中英文一視同仁：`/代碼`、`/code`、`/程式` 都找得到程式碼區塊。
 */
export function searchCommands(query: string, commands = allSlashCommands()): SlashCommand[] {
  return commands
    .map((c) => ({ c, score: scoreCommand(c, query) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.c.sortOrder - b.c.sortOrder)
    .map((x) => x.c);
}

/** 依分組把結果切成小節（保留搜尋名次） */
export function groupCommands(commands: SlashCommand[]): { group: CommandGroup; items: SlashCommand[] }[] {
  const map = new Map<CommandGroup, SlashCommand[]>();
  for (const c of commands) {
    const list = map.get(c.group);
    if (list) list.push(c);
    else map.set(c.group, [c]);
  }
  return COMMAND_GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g) as SlashCommand[] }));
}

export { scoreSpec };
