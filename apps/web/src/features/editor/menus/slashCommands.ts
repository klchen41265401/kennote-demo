/**
 * `/` 斜線選單的指令表 —— **Notion 7.34 zh-TW 的 164 項完整還原**。
 *
 * 真值來源：`reference/notion-capture/_slash-menu-full.json`
 * （實機把整個選單捲完抓下來的 164 個項目，含分組與順序）。
 * `__tests__/slash.test.ts` 會逐項比對「標籤 + 右側提示 + 順序」，
 * 少一項、順序錯一格、文案改一個字都會紅。**要改這張表，先去改 Notion。**
 *
 * 分組與順序（照抄）：
 *   建議 → 基本區塊 → 媒體 → 資料庫 → 進階區塊 → 行內 → 嵌入 → 匯入
 *        → 轉換成 → 動作 → 文字顏色 → 背景顏色
 *
 * 搜尋支援三種輸入：中文（`/程式`）、英文（`/code`）、拼音首字母（`/cs`）。
 */
import type { BlockType } from '@kennote/shared-types';
import { listSpecs, scoreSpec, type BlockSpec } from '../blocks/registry';
import { EMBED_SERVICES, IMPORT_SOURCES } from '../lib/embed-services';
import { pinyinInitials } from '../lib/pinyin';
import type { IconName } from '../ui/icons';

export type CommandGroup =
  | 'suggested'
  | 'basic'
  | 'media'
  | 'database'
  | 'advanced'
  | 'inline'
  | 'embed'
  | 'import'
  | 'turnInto'
  | 'actions'
  | 'color'
  | 'background';

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  suggested: '建議',
  basic: '基本區塊',
  media: '媒體',
  database: '資料庫',
  advanced: '進階區塊',
  inline: '行內',
  embed: '嵌入',
  import: '匯入',
  turnInto: '轉換成',
  actions: '動作',
  color: '文字顏色',
  background: '背景顏色',
};

export const COMMAND_GROUP_ORDER: CommandGroup[] = [
  'suggested',
  'basic',
  'media',
  'database',
  'advanced',
  'inline',
  'embed',
  'import',
  'turnInto',
  'actions',
  'color',
  'background',
];

/* ── 顏色（03 §6.2 的 block_color / tokens.md §3.3–3.4）────── */

export const BLOCK_COLORS: { id: string; label: string; cssVar: string | null }[] = [
  { id: 'default', label: '預設文字', cssVar: null },
  { id: 'gray', label: '灰色文字', cssVar: '--kn-color-block-gray' },
  { id: 'brown', label: '棕色文字', cssVar: '--kn-color-block-brown' },
  { id: 'orange', label: '橘色文字', cssVar: '--kn-color-block-orange' },
  { id: 'yellow', label: '黃色文字', cssVar: '--kn-color-block-yellow' },
  { id: 'green', label: '綠色文字', cssVar: '--kn-color-block-green' },
  { id: 'blue', label: '藍色文字', cssVar: '--kn-color-block-blue' },
  { id: 'purple', label: '紫色文字', cssVar: '--kn-color-block-purple' },
  { id: 'pink', label: '粉色文字', cssVar: '--kn-color-block-pink' },
  { id: 'red', label: '紅色文字', cssVar: '--kn-color-block-red' },
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
  { id: 'pink_background', label: '粉色背景', cssVar: '--kn-color-block-pink-bg' },
  { id: 'red_background', label: '紅色背景', cssVar: '--kn-color-block-red-bg' },
];

/* ── Action ─────────────────────────────────────────────── */

export type DatabaseViewKind = 'table' | 'board' | 'gallery' | 'list' | 'calendar' | 'timeline';

export type SlashAction =
  /** 轉換目前 block / 在下方插入一個 block */
  | { kind: 'block'; type: BlockType; mode: 'convert' | 'insert'; props?: Record<string, unknown> }
  /** 顏色與背景色（套用在目前 block 的 props.color） */
  | { kind: 'color'; color: string }
  /** 行內：開對應的次級選單或直接插 atom */
  | { kind: 'inline'; inline: 'mention' | 'pageLink' | 'date' | 'equation' | 'emoji' }
  /** N 欄版面 */
  | { kind: 'columns'; count: number }
  /** 連結到既有頁面（開頁面選擇器） */
  | { kind: 'linkToPage' }
  /** 建立資料庫：內嵌 / 整頁，並指定第一個瀏覽模式 */
  | { kind: 'database'; view: DatabaseViewKind; mode: 'inline' | 'fullPage' }
  /** 連結既有資料來源（開資料庫選擇器） */
  | { kind: 'linkDatabase' }
  /** 嵌入某個服務（都是同一種 embed block，只差 props.service） */
  | { kind: 'embed'; service: string }
  /** 匯入檔案（開檔案選擇器 → POST /api/import） */
  | { kind: 'import'; source: string }
  /** 區塊動作（與 block handle 選單共用同一組實作） */
  | { kind: 'blockAction'; action: 'copyLink' | 'duplicate' | 'moveTo' | 'delete' }
  /** 尚未實作：選單上標「即將推出」，點下去只跳說明 */
  | { kind: 'soon'; feature: string };

export interface SlashCommand {
  id: string;
  group: CommandGroup;
  label: string;
  labelEn: string;
  description?: string;
  icon: IconName;
  /** 沒有專屬 icon 的第三方服務用單字 monogram */
  glyph?: string;
  /** 右側灰字：markdown 縮寫或快捷鍵 */
  hint?: string;
  /** 名稱後面的灰字來源分組（Notion 的 `HTML · 嵌入區塊`），重名時用來消歧義 */
  groupLabel?: string;
  /** 右側標籤：Notion 的「新」；我們另外用「即將推出」 */
  badge?: '新' | '即將推出';
  keywords: string[];
  sortOrder: number;
  swatchVar?: string | null;
  action: SlashAction;
}

/* ── 小工具 ─────────────────────────────────────────────── */

let order = 0;
const next = (): number => (order += 10);

interface Input {
  id: string;
  group: CommandGroup;
  label: string;
  labelEn: string;
  icon: IconName;
  description?: string;
  glyph?: string;
  hint?: string;
  groupLabel?: string;
  badge?: '新' | '即將推出';
  keywords?: string[];
  swatchVar?: string | null;
  action: SlashAction;
}

function cmd(input: Input): SlashCommand {
  const initials = pinyinInitials(input.label);
  const keywords = new Set<string>([
    ...(input.keywords ?? []),
    input.label,
    input.labelEn.toLowerCase(),
  ]);
  if (initials) keywords.add(initials);
  const command: SlashCommand = {
    id: input.id,
    group: input.group,
    label: input.label,
    labelEn: input.labelEn,
    icon: input.icon,
    keywords: [...keywords],
    sortOrder: next(),
    action: input.action,
  };
  if (input.description !== undefined) command.description = input.description;
  if (input.glyph !== undefined) command.glyph = input.glyph;
  if (input.hint !== undefined) command.hint = input.hint;
  if (input.groupLabel !== undefined) command.groupLabel = input.groupLabel;
  if (input.badge !== undefined) command.badge = input.badge;
  if (input.swatchVar !== undefined) command.swatchVar = input.swatchVar;
  return command;
}

/** 從 block registry 取用文案，避免同一件事寫兩遍 */
function spec(type: BlockType): BlockSpec {
  const found = listSpecs().find((s) => s.type === type);
  if (!found) throw new Error(`[slashCommands] 找不到 BlockSpec: ${type}`);
  return found;
}

function blockCmd(
  id: string,
  group: CommandGroup,
  type: BlockType,
  extra: Partial<Input> & { mode?: 'convert' | 'insert'; props?: Record<string, unknown> } = {},
): SlashCommand {
  const s = spec(type);
  const { mode, props, ...rest } = extra;
  return cmd({
    id,
    group,
    label: s.label,
    labelEn: s.labelEn,
    description: s.description,
    icon: s.icon,
    keywords: s.keywords,
    ...rest,
    action: {
      kind: 'block',
      type,
      mode: mode ?? s.insertMode,
      props: props ?? s.defaultProps,
    },
  });
}

/* ── 1. 建議 ────────────────────────────────────────────── */

const SUGGESTED: SlashCommand[] = [
  cmd({
    id: 'ai:writer',
    group: 'suggested',
    label: 'AI 筆記寫手',
    labelEn: 'AI note writer',
    description: '讓 AI 幫你把這一段寫出來',
    icon: 'ai',
    badge: '即將推出',
    keywords: ['ai', 'write', 'gpt', '筆記', '寫手', '人工智慧'],
    action: { kind: 'soon', feature: 'AI 筆記寫手' },
  }),
  cmd({
    id: 'suggested:html',
    group: 'suggested',
    label: 'HTML',
    labelEn: 'HTML',
    description: '嵌入一段 HTML',
    icon: 'html',
    // `_slash-menu-full.json` 第 2 項是 "HTML | · | 嵌入區塊 | 新"：
    // 「· 嵌入區塊」緊接在名稱後面（灰字），標示這一項**原本屬於哪一組** ——
    // 「建議」裡的項目都是別組的複本，重名時 Notion 就是這樣消歧義的。
    // 它不是右側對齊的 hint（右側那格放的是徽章「新」）。
    groupLabel: '嵌入區塊',
    badge: '新',
    keywords: ['html', 'iframe', 'embed', '嵌入', '網頁'],
    action: { kind: 'embed', service: 'html' },
  }),
  blockCmd('suggested:bookmark', 'suggested', 'bookmark'),
  blockCmd('suggested:callout', 'suggested', 'callout'),
];

/* ── 2. 基本區塊 ────────────────────────────────────────── */

const BASIC: SlashCommand[] = [
  blockCmd('block:paragraph', 'basic', 'paragraph'),
  blockCmd('block:heading1', 'basic', 'heading1', { hint: '#' }),
  blockCmd('block:heading2', 'basic', 'heading2', { hint: '##' }),
  blockCmd('block:heading3', 'basic', 'heading3', { hint: '###' }),
  blockCmd('block:heading4', 'basic', 'heading4', { hint: '####' }),
  blockCmd('block:bulletedList', 'basic', 'bulletedList', { hint: '-' }),
  blockCmd('block:numberedList', 'basic', 'numberedList', { hint: '1.' }),
  blockCmd('block:todo', 'basic', 'todo', { hint: '[]' }),
  blockCmd('block:toggle', 'basic', 'toggle', { hint: '>' }),
  blockCmd('block:page', 'basic', 'page'),
  blockCmd('block:quote', 'basic', 'quote', { hint: '"' }),
  blockCmd('block:table', 'basic', 'table'),
  blockCmd('block:divider', 'basic', 'divider', { hint: '---' }),
  cmd({
    id: 'link:page',
    group: 'basic',
    label: '連結到頁面',
    labelEn: 'Link to page',
    description: '連到工作區裡已經存在的頁面',
    icon: 'link-to-page',
    keywords: ['link', 'page', 'mention', '連結', '頁面', '連到'],
    action: { kind: 'linkToPage' },
  }),
];

/* ── 3. 媒體 ────────────────────────────────────────────── */

const MEDIA: SlashCommand[] = [
  blockCmd('block:image', 'media', 'image'),
  blockCmd('block:video', 'media', 'video'),
  blockCmd('block:audio', 'media', 'audio'),
  blockCmd('block:code', 'media', 'code', { hint: '```' }),
  blockCmd('block:file', 'media', 'file'),
];

/* ── 4. 資料庫 ──────────────────────────────────────────── */

const dbView = (
  id: string,
  label: string,
  labelEn: string,
  icon: IconName,
  view: DatabaseViewKind | null,
  extra: { badge?: '新' | '即將推出'; keywords?: string[] } = {},
): SlashCommand =>
  cmd({
    id,
    group: 'database',
    label,
    labelEn,
    description: `建立一個新的資料庫，並以${label.replace('瀏覽模式', '')}呈現`,
    icon,
    keywords: ['database', 'db', 'view', '資料庫', '瀏覽模式', ...(extra.keywords ?? [])],
    // 佔位項目（還沒實作的瀏覽模式 / 圖表）標「即將推出」，其餘沿用 Notion 的徽章。
    ...(extra.badge ? { badge: extra.badge } : view === null ? { badge: '即將推出' as const } : {}),
    action: view ? { kind: 'database', view, mode: 'inline' } : { kind: 'soon', feature: label },
  });

const DATABASE: SlashCommand[] = [
  dbView('db:table', '表格瀏覽模式', 'Table view', 'db-table', 'table', { keywords: ['table', 'grid'] }),
  dbView('db:board', '看板瀏覽模式', 'Board view', 'db-board', 'board', { keywords: ['board', 'kanban'] }),
  dbView('db:gallery', '圖庫瀏覽模式', 'Gallery view', 'db-gallery', 'gallery', { keywords: ['gallery', 'card'] }),
  dbView('db:list', '列表瀏覽模式', 'List view', 'db-list', 'list', { keywords: ['list'] }),
  dbView('db:feed', '動態瀏覽模式', 'Feed view', 'db-feed', null, { keywords: ['feed'] }),
  dbView('db:dashboard', '儀表板瀏覽模式', 'Dashboard view', 'db-dashboard', null, {
    badge: '新',
    keywords: ['dashboard'],
  }),
  dbView('db:calendar', '日曆瀏覽模式', 'Calendar view', 'db-calendar', 'calendar', { keywords: ['calendar'] }),
  dbView('db:timeline', '時間軸瀏覽模式', 'Timeline view', 'db-timeline', 'timeline', {
    keywords: ['timeline', 'gantt', '時程', '甘特'],
  }),
  dbView('db:map', '地圖瀏覽模式', 'Map view', 'db-map', null, { keywords: ['map'] }),
  dbView('db:barV', '垂直長條圖', 'Bar chart', 'chart-bar-v', null, { keywords: ['chart', 'bar'] }),
  dbView('db:barH', '水平長條圖', 'Horizontal bar chart', 'chart-bar-h', null, { keywords: ['chart', 'bar'] }),
  dbView('db:line', '折線圖', 'Line chart', 'chart-line', null, { keywords: ['chart', 'line'] }),
  dbView('db:donut', '環形圖', 'Donut chart', 'chart-donut', null, { keywords: ['chart', 'donut', 'pie'] }),
  dbView('db:number', '數字圖表', 'Number chart', 'chart-number', null, { keywords: ['chart', 'number', 'metric'] }),
  dbView('db:form', '表單', 'Form', 'form', null, { keywords: ['form', 'survey'] }),
  cmd({
    id: 'db:inline',
    group: 'database',
    label: '資料庫 - 內嵌',
    labelEn: 'Database - Inline',
    description: '在這一頁裡放一個資料庫',
    icon: 'db-inline',
    keywords: ['database', 'inline', '資料庫', '內嵌'],
    action: { kind: 'database', view: 'table', mode: 'inline' },
  }),
  cmd({
    id: 'db:fullPage',
    group: 'database',
    label: '資料庫 - 整頁',
    labelEn: 'Database - Full page',
    description: '建立一個資料庫子頁面',
    icon: 'db-fullpage',
    keywords: ['database', 'full', 'page', '資料庫', '整頁'],
    action: { kind: 'database', view: 'table', mode: 'fullPage' },
  }),
  cmd({
    id: 'db:link',
    group: 'database',
    label: '資料來源的連結瀏覽模式',
    labelEn: 'Linked view of data source',
    description: '顯示工作區裡既有的資料庫',
    icon: 'db-link',
    keywords: ['linked', 'database', 'view', '連結', '資料來源', '既有'],
    action: { kind: 'linkDatabase' },
  }),
];

/* ── 5. 進階區塊 ────────────────────────────────────────── */

const ADVANCED: SlashCommand[] = [
  blockCmd('block:tableOfContents', 'advanced', 'tableOfContents'),
  blockCmd('block:equation', 'advanced', 'equation'),
  blockCmd('block:button', 'advanced', 'button'),
  blockCmd('block:breadcrumb', 'advanced', 'breadcrumb'),
  cmd({
    id: 'advanced:tabs',
    group: 'advanced',
    label: '分頁',
    labelEn: 'Tabs',
    description: '把內容分成多個分頁',
    icon: 'tabs',
    badge: '新',
    keywords: ['tab', 'tabs', '分頁', '頁籤'],
    action: { kind: 'soon', feature: '分頁' },
  }),
  blockCmd('block:syncedBlock', 'advanced', 'syncedBlock'),
  ...([1, 2, 3] as const).map((level) =>
    cmd({
      id: `toggleHeading:${level}`,
      group: 'advanced',
      label: `摺疊標題 ${level}`,
      labelEn: `Toggle heading ${level}`,
      description: `可以收合的標題 ${level}`,
      icon: 'toggle-heading',
      hint: `${'#'.repeat(level)} >`,
      keywords: ['toggle', 'heading', `h${level}`, '摺疊', '標題', '收合'],
      action: {
        kind: 'block',
        type: `heading${level}` as BlockType,
        mode: 'convert',
        props: { toggleable: true },
      },
    }),
  ),
  ...([2, 3, 4, 5] as const).map((count) =>
    cmd({
      id: `columns:${count}`,
      group: 'advanced',
      label: `${count} 欄`,
      labelEn: `${count} columns`,
      description: `把內容並排成 ${count} 欄`,
      icon: 'columns',
      keywords: ['column', 'columns', 'layout', '多欄', '分欄', '欄', `${count}欄`],
      action: { kind: 'columns', count },
    }),
  ),
  cmd({
    id: 'code:mermaid',
    group: 'advanced',
    label: '程式碼 - Mermaid',
    labelEn: 'Code - Mermaid',
    description: '用 Mermaid 語法寫流程圖',
    icon: 'mermaid',
    keywords: ['mermaid', 'diagram', 'flowchart', '流程圖', '圖表', '程式碼'],
    action: { kind: 'block', type: 'code', mode: 'convert', props: { language: 'mermaid' } },
  }),
  cmd({
    id: 'ai:block',
    group: 'advanced',
    label: 'AI 區塊',
    labelEn: 'AI block',
    description: '讓 AI 產生摘要、待辦或翻譯',
    icon: 'ai',
    badge: '即將推出',
    keywords: ['ai', 'summary', 'translate', '摘要', '翻譯', '區塊'],
    action: { kind: 'soon', feature: 'AI 區塊' },
  }),
];

/* ── 6. 行內 ────────────────────────────────────────────── */

const INLINE: SlashCommand[] = [
  cmd({
    id: 'inline:mention',
    group: 'inline',
    label: '提及人員',
    labelEn: 'Mention a person',
    description: '用 @ 提及工作區成員',
    icon: 'user',
    keywords: ['mention', 'person', 'people', 'user', '提及', '人員', '成員', '@'],
    action: { kind: 'inline', inline: 'mention' },
  }),
  cmd({
    id: 'inline:pageLink',
    group: 'inline',
    label: '提及頁面或資料來源',
    labelEn: 'Mention a page or data source',
    description: '插入指向其他頁面的行內連結',
    icon: 'page',
    keywords: ['link', 'page', 'mention', 'database', '連結', '頁面', '資料來源', '[['],
    action: { kind: 'inline', inline: 'pageLink' },
  }),
  cmd({
    id: 'inline:date',
    group: 'inline',
    label: '日期或提醒',
    labelEn: 'Date or reminder',
    description: '插入日期，或設定一個提醒',
    icon: 'calendar',
    keywords: ['date', 'today', 'time', 'reminder', '日期', '今天', '時間', '提醒'],
    action: { kind: 'inline', inline: 'date' },
  }),
  cmd({
    id: 'inline:emoji',
    group: 'inline',
    label: '表情符號',
    labelEn: 'Emoji',
    description: '插入表情符號',
    icon: 'emoji',
    keywords: ['emoji', 'icon', 'smile', '表情', '符號'],
    action: { kind: 'inline', inline: 'emoji' },
  }),
  cmd({
    id: 'inline:equation',
    group: 'inline',
    label: '行內方程式',
    labelEn: 'Inline equation',
    description: '在文字中插入 LaTeX 方程式',
    icon: 'equation-inline',
    keywords: ['equation', 'math', 'latex', '公式', '數學', '方程式', '行內'],
    action: { kind: 'inline', inline: 'equation' },
  }),
];

/* ── 7. 嵌入（53 項：52 個服務 + PDF）──────────────────── */

function embedCmd(serviceId: string): SlashCommand {
  const service = EMBED_SERVICES.find((s) => s.id === serviceId);
  if (!service) throw new Error(`[slashCommands] 找不到 embed service: ${serviceId}`);
  return cmd({
    id: `embed:${service.id}`,
    group: 'embed',
    label: service.label,
    labelEn: service.labelEn,
    description: service.domain ? `嵌入 ${service.domain} 的內容` : '嵌入任何外部內容',
    icon: service.icon ?? 'embed',
    ...(service.icon ? {} : { glyph: service.label.slice(0, 1).toUpperCase() }),
    ...(service.id === 'html' ? { badge: '新' as const } : {}),
    keywords: [...service.keywords, '嵌入', 'embed'],
    action: { kind: 'embed', service: service.id },
  });
}

const EMBED: SlashCommand[] = (() => {
  const out: SlashCommand[] = [];
  for (const service of EMBED_SERVICES) {
    out.push(embedCmd(service.id));
    // Notion 把 PDF 夾在 Excalidraw 與 Loom 之間（它其實是 pdf block，不是 embed）
    if (service.id === 'excalidraw') out.push(blockCmd('block:pdf', 'embed', 'pdf'));
  }
  return out;
})();

/* ── 8. 匯入 ────────────────────────────────────────────── */

const IMPORT: SlashCommand[] = IMPORT_SOURCES.map((source) =>
  cmd({
    id: `import:${source.id}`,
    group: 'import',
    label: source.label,
    labelEn: source.labelEn,
    description: source.hint,
    icon: source.icon,
    ...(source.id === 'googleDocs' ? { badge: '新' as const } : {}),
    keywords: [...source.keywords, '匯入', 'import'],
    action: { kind: 'import', source: source.id },
  }),
);

/* ── 9. 轉換成（游標所在 block 有內容時才出現）─────────── */

const TURN_INTO: SlashCommand[] = [
  ...([1, 2, 3, 4] as const).map((level) =>
    blockCmd(`turnInto:heading${level}`, 'turnInto', `heading${level}` as BlockType, { mode: 'convert' }),
  ),
  blockCmd('turnInto:bulletedList', 'turnInto', 'bulletedList', { mode: 'convert' }),
  blockCmd('turnInto:numberedList', 'turnInto', 'numberedList', { mode: 'convert' }),
  blockCmd('turnInto:todo', 'turnInto', 'todo', { mode: 'convert' }),
  blockCmd('turnInto:toggle', 'turnInto', 'toggle', { mode: 'convert' }),
  blockCmd('turnInto:code', 'turnInto', 'code', { mode: 'convert' }),
  blockCmd('turnInto:quote', 'turnInto', 'quote', { mode: 'convert' }),
  ...([1, 2, 3, 4] as const).map((level) =>
    cmd({
      id: `turnInto:toggleHeading${level}`,
      group: 'turnInto',
      label: `摺疊標題 ${level}`,
      labelEn: `Toggle heading ${level}`,
      description: `轉換成可以收合的標題 ${level}`,
      icon: 'toggle-heading',
      keywords: ['toggle', 'heading', `h${level}`, '摺疊', '標題', '收合'],
      action: {
        kind: 'block',
        type: `heading${level}` as BlockType,
        mode: 'convert',
        props: { toggleable: true },
      },
    }),
  ),
];

/* ── 10. 動作 ───────────────────────────────────────────── */

const ACTIONS: SlashCommand[] = [
  cmd({
    id: 'action:copyLink',
    group: 'actions',
    label: '複製區塊連結',
    labelEn: 'Copy link to block',
    description: '複製可以直接跳到這個區塊的網址',
    icon: 'link',
    hint: 'Alt+⇧+L',
    keywords: ['copy', 'link', 'anchor', '複製', '連結', '區塊'],
    action: { kind: 'blockAction', action: 'copyLink' },
  }),
  cmd({
    id: 'action:duplicate',
    group: 'actions',
    label: '建立複本',
    labelEn: 'Duplicate',
    description: '在下方複製一份',
    icon: 'copy',
    hint: 'Ctrl+D',
    keywords: ['duplicate', 'copy', '複製', '複本', '建立'],
    action: { kind: 'blockAction', action: 'duplicate' },
  }),
  cmd({
    id: 'action:moveTo',
    group: 'actions',
    label: '移動到',
    labelEn: 'Move to',
    description: '把這個區塊搬到其他頁面',
    icon: 'move',
    hint: 'Ctrl+⇧+P',
    keywords: ['move', 'to', '移動', '搬移'],
    action: { kind: 'blockAction', action: 'moveTo' },
  }),
  cmd({
    id: 'action:delete',
    group: 'actions',
    label: '刪除',
    labelEn: 'Delete',
    description: '刪除這個區塊',
    icon: 'trash',
    hint: 'Del',
    keywords: ['delete', 'remove', '刪除', '移除'],
    action: { kind: 'blockAction', action: 'delete' },
  }),
  cmd({
    id: 'action:askAi',
    group: 'actions',
    label: '萬事問 AI',
    labelEn: 'Ask AI',
    description: '請 AI 處理這個區塊',
    icon: 'ai',
    hint: 'Ctrl+J',
    badge: '即將推出',
    keywords: ['ai', 'ask', '問', '萬事'],
    action: { kind: 'soon', feature: '萬事問 AI' },
  }),
];

/* ── 11–12. 顏色 / 背景色 ───────────────────────────────── */

const COLOR: SlashCommand[] = BLOCK_COLORS.map((c) =>
  cmd({
    id: `color:${c.id}`,
    group: 'color',
    label: c.label,
    labelEn: `${c.id} text`,
    icon: 'palette',
    swatchVar: c.cssVar,
    keywords: ['color', 'text', c.id, '顏色', '文字色'],
    action: { kind: 'color', color: c.id },
  }),
);

const BACKGROUND: SlashCommand[] = BLOCK_BACKGROUNDS.map((c) =>
  cmd({
    id: `bg:${c.id}`,
    group: 'background',
    label: c.label,
    labelEn: `${c.id.replace('_background', '')} background`,
    icon: 'palette',
    swatchVar: c.cssVar,
    keywords: ['background', 'bg', c.id, '背景', '背景色'],
    action: { kind: 'color', color: c.id },
  }),
);

/* ── 組裝 ───────────────────────────────────────────────── */

const ALL: SlashCommand[] = [
  ...SUGGESTED,
  ...BASIC,
  ...MEDIA,
  ...DATABASE,
  ...ADVANCED,
  ...INLINE,
  ...EMBED,
  ...IMPORT,
  ...TURN_INTO,
  ...ACTIONS,
  ...COLOR,
  ...BACKGROUND,
];

export function allSlashCommands(): SlashCommand[] {
  return ALL;
}

export function getSlashCommand(id: string): SlashCommand | undefined {
  return ALL.find((c) => c.id === id);
}

/* ── 搜尋 ───────────────────────────────────────────────── */

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
  // 「標題 1」打成「標題1」也要找得到
  const compact = label.replace(/\s+/g, '');
  if (compact.includes(q.replace(/\s+/g, ''))) return 6;
  return -1;
}

export interface SearchOptions {
  /** 目前 block 是不是空的：Notion 只在「有內容」時顯示「轉換成」 */
  blockHasContent?: boolean;
  /** 最近用過的指令 id（最新在前），會浮到「建議」分組的最前面 */
  recentIds?: string[];
}

/**
 * 搜尋。空查詢時回傳全部（依分組順序）。
 * 中文 / 英文 / 拼音首字母一視同仁：`/程式`、`/code`、`/cs` 都找得到程式碼區塊。
 */
export function searchCommands(
  query: string,
  commands: SlashCommand[] = ALL,
  options: SearchOptions = {},
): SlashCommand[] {
  const pool =
    options.blockHasContent === false ? commands.filter((c) => c.group !== 'turnInto') : commands;
  const recent = options.recentIds ?? [];
  return pool
    .map((c) => ({ c, score: scoreCommand(c, query) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      if (a.c.group === 'suggested' && b.c.group === 'suggested') {
        const ra = recent.indexOf(a.c.id);
        const rb = recent.indexOf(b.c.id);
        if (ra !== rb) return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
      }
      return a.c.sortOrder - b.c.sortOrder;
    })
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
  return COMMAND_GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
    group: g,
    items: map.get(g) as SlashCommand[],
  }));
}

export { scoreSpec };
