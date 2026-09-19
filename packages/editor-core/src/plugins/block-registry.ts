/**
 * Block Type Registry —— 一個 block type 的所有知識集中在一個模組（04 §10.1）。
 *
 * 新增 block type = 寫一個 definition + registerBlock 一行；
 * slash menu、轉換選單、markdown 捷徑、匯出、剪貼簿全部自動支援，不用改 switch。
 */
import type { Block, BlockType, RichText } from '../model/types.js';
import { toPlainText } from '../text/richtext.js';
import { el, escapeAttr, escapeHtml, safeUrl } from '../view/dom-utils.js';
import { BLOCK_CONTENT_ATTR } from '../selection/dom-mapper.js';

export type BlockGroup = 'basic' | 'media' | 'database' | 'advanced' | 'embed';

export interface RenderCtx {
  doc: Document;
  /** 是否可編輯（唯讀模式 / 佔位 renderer 為 false）。 */
  editable: boolean;
}

export interface MarkdownShortcut {
  /** 對「block 起始到游標」的純文字做比對。 */
  pattern: RegExp;
  getProps?(match: RegExpMatchArray): Record<string, unknown>;
}

export interface BlockDefinition {
  type: BlockType;

  // ── Slash menu 與 UI ──
  label: string;
  description: string;
  iconName: string;
  group: BlockGroup;
  /** 中英文都放，slash menu 直接吃這個。 */
  keywords: string[];
  sortOrder: number;

  // ── 資料 ──
  defaultProps: Record<string, unknown>;
  validateProps(props: unknown): Record<string, unknown>;
  canHaveChildren: boolean;
  hasInlineContent: boolean;
  /** false = 佔位 renderer（M2-A 尚未實作的型別），不可編輯但不會壞掉。 */
  editable: boolean;
  placeholder?: string;

  // ── 渲染（vanilla DOM，不綁框架）──
  /** 回傳 block 的主元素；若 hasInlineContent，其中必須有一個 [data-block-content] 元素。 */
  render(block: Block, ctx: RenderCtx): HTMLElement;
  /** 增量更新 props 相關的 chrome。回 false 代表「請重建」。 */
  update?(main: HTMLElement, prev: Block, next: Block): boolean;

  // ── 編輯行為 ──
  splitBehavior: 'split' | 'newParagraph' | 'exit' | 'none';
  /** Enter 分割後，後半段的型別。 */
  splitInto?: BlockType;
  /** 空 block 按 Enter 時跳出成什麼型別。 */
  exitInto?: BlockType;
  markdownShortcut?: MarkdownShortcut[];
  shortcut?: string;
  convertibleTo?: BlockType[];

  // ── 剪貼簿 ──
  parseHTML?: { tag: string; match?(element: Element): boolean; getProps?(element: Element): Record<string, unknown> }[];
  toHTML(block: Block, inner: string, childrenHTML: string): string;
  toMarkdown(block: Block, inner: string, childrenMd: string): string;
}

export class BlockRegistry {
  private readonly defs = new Map<BlockType, BlockDefinition>();

  register(def: BlockDefinition): this {
    if (this.defs.has(def.type)) throw new Error(`[editor-core] Block type 重複註冊: ${def.type}`);
    this.defs.set(def.type, def);
    return this;
  }

  /** 覆寫既有定義（宿主想換掉預設 renderer 時用）。 */
  override(def: BlockDefinition): this {
    this.defs.set(def.type, def);
    return this;
  }

  get(type: BlockType): BlockDefinition {
    return this.defs.get(type) ?? this.defs.get('paragraph') ?? fallbackDefinition(type);
  }

  has(type: BlockType): boolean {
    return this.defs.has(type);
  }

  list(): BlockDefinition[] {
    return [...this.defs.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /** Slash menu 直接吃這個，零 if-else。 */
  search(query: string): BlockDefinition[] {
    const q = query.trim().toLowerCase();
    const all = this.list().filter((d) => d.editable || d.type === 'divider');
    if (q === '') return all;
    const score = (d: BlockDefinition): number => {
      const label = d.label.toLowerCase();
      if (label === q) return 0;
      if (label.startsWith(q)) return 1;
      if (d.keywords.some((k) => k.toLowerCase() === q)) return 2;
      if (d.keywords.some((k) => k.toLowerCase().startsWith(q))) return 3;
      if (label.includes(q)) return 4;
      if (d.keywords.some((k) => k.toLowerCase().includes(q))) return 5;
      return -1;
    };
    return all
      .map((d) => ({ d, s: score(d) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.d.sortOrder - b.d.sortOrder)
      .map((x) => x.d);
  }

  /** 所有 markdown 捷徑一次組出來給 input-rules.ts。 */
  allMarkdownShortcuts(): { type: BlockType; shortcut: MarkdownShortcut }[] {
    return this.list().flatMap((d) => (d.markdownShortcut ?? []).map((shortcut) => ({ type: d.type, shortcut })));
  }
}

// ─────────────────────────────────────────────────────────────
// 預設定義
// ─────────────────────────────────────────────────────────────

function contentEl(ctx: RenderCtx, tag: keyof HTMLElementTagNameMap, className: string, editable: boolean): HTMLElement {
  const node = el(ctx.doc, tag, { class: `kn-block-content ${className}`, [BLOCK_CONTENT_ATTR]: 'true' });
  if (editable && ctx.editable) {
    node.setAttribute('contenteditable', 'true');
    node.setAttribute('role', 'textbox');
    node.setAttribute('aria-multiline', 'false');
    node.setAttribute('spellcheck', 'false');
  }
  return node;
}

function passthroughProps(props: unknown): Record<string, unknown> {
  return props && typeof props === 'object' ? { ...(props as Record<string, unknown>) } : {};
}

interface SimpleDefInput {
  type: BlockType;
  label: string;
  description: string;
  iconName: string;
  keywords: string[];
  sortOrder: number;
  tag: keyof HTMLElementTagNameMap;
  className: string;
  placeholder?: string;
  splitInto?: BlockType;
  exitInto?: BlockType;
  markdownShortcut?: MarkdownShortcut[];
  shortcut?: string;
  canHaveChildren?: boolean;
  htmlTag?: string;
  mdPrefix?: string;
  group?: BlockGroup;
}

function simpleTextBlock(input: SimpleDefInput): BlockDefinition {
  const htmlTag = input.htmlTag ?? String(input.tag);
  const def: BlockDefinition = {
    type: input.type,
    label: input.label,
    description: input.description,
    iconName: input.iconName,
    group: input.group ?? 'basic',
    keywords: input.keywords,
    sortOrder: input.sortOrder,
    defaultProps: {},
    validateProps: passthroughProps,
    canHaveChildren: input.canHaveChildren ?? true,
    hasInlineContent: true,
    editable: true,
    splitBehavior: 'split',
    convertibleTo: [
      'paragraph',
      'heading1',
      'heading2',
      'heading3',
      'heading4',
      'bulletedList',
      'numberedList',
      'todo',
      'toggle',
      'quote',
      'callout',
      'code',
    ],
    render(_block, ctx) {
      return contentEl(ctx, input.tag, input.className, true);
    },
    toHTML(_block, inner, childrenHTML) {
      return `<${htmlTag}>${inner}</${htmlTag}>${childrenHTML}`;
    },
    toMarkdown(_block, inner, childrenMd) {
      const prefix = input.mdPrefix ?? '';
      return `${prefix}${inner}\n${childrenMd}`;
    },
  };
  if (input.placeholder !== undefined) def.placeholder = input.placeholder;
  if (input.splitInto !== undefined) def.splitInto = input.splitInto;
  if (input.exitInto !== undefined) def.exitInto = input.exitInto;
  if (input.markdownShortcut !== undefined) def.markdownShortcut = input.markdownShortcut;
  if (input.shortcut !== undefined) def.shortcut = input.shortcut;
  return def;
}

/** 未實作型別的「不可編輯佔位 renderer」。 */
export function placeholderDefinition(
  type: BlockType,
  label: string,
  iconName: string,
  group: BlockGroup,
  sortOrder: number,
  keywords: string[] = [],
): BlockDefinition {
  return {
    type,
    label,
    description: `${label}（尚未實作，顯示為佔位元素）`,
    iconName,
    group,
    keywords,
    sortOrder,
    defaultProps: {},
    validateProps: passthroughProps,
    canHaveChildren: type === 'column' || type === 'columnList' || type === 'page' || type === 'table',
    hasInlineContent: false,
    editable: false,
    splitBehavior: 'none',
    render(block, ctx) {
      const node = el(ctx.doc, 'div', { class: `kn-block-placeholder kn-block-placeholder--${type}`, contenteditable: 'false' });
      node.textContent = `[${label}]`;
      node.setAttribute('data-unimplemented', type);
      if (block.content.length > 0) node.setAttribute('title', toPlainText(block.content));
      return node;
    },
    toHTML(block) {
      return `<div data-kn-block="${escapeAttr(type)}">${escapeHtml(toPlainText(block.content))}</div>`;
    },
    toMarkdown(block) {
      const text = toPlainText(block.content);
      return text ? `${text}\n` : '';
    },
  };
}

function fallbackDefinition(type: BlockType): BlockDefinition {
  return placeholderDefinition(type, type, 'box', 'advanced', 9999);
}

const FW = '[ \\u3000]'; // 半形或全形空白

export function createDefaultRegistry(): BlockRegistry {
  const registry = new BlockRegistry();

  registry.register(
    simpleTextBlock({
      type: 'paragraph',
      label: '段落',
      description: '純文字內容',
      iconName: 'text',
      keywords: ['text', 'paragraph', '段落', '文字', '內文'],
      sortOrder: 10,
      tag: 'div',
      className: 'kn-paragraph',
      placeholder: '輸入文字，或輸入「/」開啟指令選單',
      htmlTag: 'p',
    }),
  );

  for (const [level, sort] of [
    [1, 20],
    [2, 30],
    [3, 40],
    [4, 45],
  ] as const) {
    const heading = simpleTextBlock({
      type: `heading${level}` as BlockType,
      label: `標題 ${level}`,
      description: `第 ${level} 層標題`,
      iconName: `heading-${level}`,
      keywords: ['heading', `h${level}`, '標題', `標題${level}`, 'title'],
      sortOrder: sort,
      tag: `h${Math.min(level + 1, 6)}` as keyof HTMLElementTagNameMap,
      className: `kn-heading kn-heading-${level}`,
      placeholder: `標題 ${level}`,
      splitInto: 'paragraph',
      shortcut: `Mod-Alt-${level}`,
      htmlTag: `h${level}`,
      mdPrefix: `${'#'.repeat(level)} `,
      markdownShortcut: [
        { pattern: new RegExp(`^[#\uff03]{${level}}${FW}$`) },
        // 「### >」= 可收合的標題（Notion 的「摺疊標題 1~4」）
        {
          pattern: new RegExp(`^[#\uff03]{${level}}${FW}[>\uff1e]${FW}$`),
          getProps: () => ({ toggleable: true }),
        },
      ],
    });

    /**
     * 可收合的標題（01 §4.4 M3.4.12 / Notion 的「摺疊標題 1~4」）。
     * 資料層只有 `props.toggleable` + `props.collapsed`，型別仍然是 heading，
     * 所以「標題 2 ⇄ 摺疊標題 2」互轉不會動到內容，也不必新增 block type。
     *
     * 箭頭刻意用 `data-heading-toggle` 而不是 `data-toggle-arrow`：
     * input/controller.ts 看到 `data-toggle-arrow` 會把 block 轉成 `toggle`，
     * 那會毀掉標題。宿主層改聽 `data-heading-toggle`（features/editor/Editor.tsx）。
     */
    const headingRender = heading.render;
    heading.render = (block, ctx) => {
      if (!block.props.toggleable) return headingRender.call(heading, block, ctx);
      const wrapper = el(ctx.doc, 'div', { class: `kn-heading-toggle kn-heading-toggle-${level}` });
      const collapsed = Boolean(block.props.collapsed);
      const arrow = el(ctx.doc, 'span', {
        class: 'kn-toggle-arrow',
        contenteditable: 'false',
        'data-heading-toggle': 'true',
        role: 'button',
        'aria-expanded': collapsed ? 'false' : 'true',
      });
      arrow.textContent = collapsed ? '▸' : '▾';
      wrapper.appendChild(arrow);
      wrapper.appendChild(
        contentEl(
          ctx,
          `h${Math.min(level + 1, 6)}` as keyof HTMLElementTagNameMap,
          `kn-heading kn-heading-${level}`,
          true,
        ),
      );
      if (collapsed) wrapper.setAttribute('data-collapsed', 'true');
      return wrapper;
    };
    heading.update = (main, prev, next) => {
      // toggleable 切換會換掉整個 DOM 結構 → 回 false 讓 BlockView 重建
      if (Boolean(prev.props.toggleable) !== Boolean(next.props.toggleable)) return false;
      if (!next.props.toggleable) return true;
      const arrow = main.querySelector<HTMLElement>('[data-heading-toggle]');
      if (!arrow) return false;
      const collapsed = Boolean(next.props.collapsed);
      arrow.textContent = collapsed ? '▸' : '▾';
      arrow.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      if (collapsed) main.setAttribute('data-collapsed', 'true');
      else main.removeAttribute('data-collapsed');
      return true;
    };
    registry.register(heading);
  }

  registry.register(
    simpleTextBlock({
      type: 'bulletedList',
      label: '項目符號清單',
      description: '無序清單',
      iconName: 'list-bulleted',
      keywords: ['bullet', 'list', 'ul', '清單', '項目', '無序'],
      sortOrder: 50,
      tag: 'div',
      className: 'kn-list kn-list-bulleted',
      placeholder: '清單項目',
      exitInto: 'paragraph',
      mdPrefix: '- ',
      htmlTag: 'li',
      markdownShortcut: [{ pattern: new RegExp(`^[-*+\\uff0d]${FW}$`) }],
    }),
  );

  registry.register(
    simpleTextBlock({
      type: 'numberedList',
      label: '編號清單',
      description: '有序清單',
      iconName: 'list-numbered',
      keywords: ['number', 'ordered', 'ol', '編號', '清單', '有序'],
      sortOrder: 60,
      tag: 'div',
      className: 'kn-list kn-list-numbered',
      placeholder: '清單項目',
      exitInto: 'paragraph',
      mdPrefix: '1. ',
      htmlTag: 'li',
      markdownShortcut: [{ pattern: new RegExp(`^(\\d+)[.)\\uff0e]${FW}$`) }],
    }),
  );

  // ── todo：有 checkbox chrome ──
  const todo = simpleTextBlock({
    type: 'todo',
    label: '待辦清單',
    description: '可勾選的待辦事項',
    iconName: 'checkbox',
    keywords: ['todo', 'checkbox', 'task', '待辦', '勾選', '清單'],
    sortOrder: 70,
    tag: 'div',
    className: 'kn-todo-text',
    placeholder: '待辦事項',
    exitInto: 'paragraph',
    markdownShortcut: [
      {
        pattern: new RegExp(`^\\[([ xX]?)\\]${FW}$`),
        getProps: (m) => ({ checked: (m[1] ?? '').toLowerCase() === 'x' }),
      },
    ],
  });
  todo.defaultProps = { checked: false };
  todo.validateProps = (props) => ({ checked: Boolean((props as { checked?: unknown } | null)?.checked) });
  todo.render = (block, ctx) => {
    const wrapper = el(ctx.doc, 'div', { class: 'kn-todo' });
    const box = el(ctx.doc, 'span', {
      class: 'kn-todo-checkbox',
      contenteditable: 'false',
      role: 'checkbox',
      'data-todo-checkbox': 'true',
      'aria-checked': block.props.checked ? 'true' : 'false',
    });
    box.textContent = block.props.checked ? '☑' : '☐';
    wrapper.appendChild(box);
    wrapper.appendChild(contentEl(ctx, 'div', 'kn-todo-text', true));
    if (block.props.checked) wrapper.setAttribute('data-checked', 'true');
    return wrapper;
  };
  todo.update = (main, _prev, next) => {
    const box = main.querySelector<HTMLElement>('[data-todo-checkbox]');
    if (!box) return false;
    const checked = Boolean(next.props.checked);
    box.setAttribute('aria-checked', checked ? 'true' : 'false');
    box.textContent = checked ? '☑' : '☐';
    if (checked) main.setAttribute('data-checked', 'true');
    else main.removeAttribute('data-checked');
    return true;
  };
  todo.toHTML = (block, inner, childrenHTML) =>
    `<li data-checked="${block.props.checked ? 'true' : 'false'}">${inner}</li>${childrenHTML}`;
  todo.toMarkdown = (block, inner, childrenMd) => `- [${block.props.checked ? 'x' : ' '}] ${inner}\n${childrenMd}`;
  registry.register(todo);

  // ── toggle：三角形 + 可折疊子層 ──
  const toggle = simpleTextBlock({
    type: 'toggle',
    label: '摺疊清單',
    description: '可展開／收合的區塊',
    iconName: 'toggle',
    keywords: ['toggle', 'collapse', 'fold', '摺疊', '收合', '折疊'],
    sortOrder: 80,
    tag: 'div',
    className: 'kn-toggle-text',
    placeholder: '摺疊標題',
    exitInto: 'paragraph',
    markdownShortcut: [{ pattern: new RegExp(`^[>\\uff1e]{2}${FW}$`) }],
  });
  toggle.defaultProps = { collapsed: false };
  toggle.validateProps = (props) => ({ collapsed: Boolean((props as { collapsed?: unknown } | null)?.collapsed) });
  toggle.render = (block, ctx) => {
    const wrapper = el(ctx.doc, 'div', { class: 'kn-toggle' });
    const arrow = el(ctx.doc, 'span', {
      class: 'kn-toggle-arrow',
      contenteditable: 'false',
      'data-toggle-arrow': 'true',
      role: 'button',
      'aria-expanded': block.props.collapsed ? 'false' : 'true',
    });
    arrow.textContent = block.props.collapsed ? '▸' : '▾';
    wrapper.appendChild(arrow);
    wrapper.appendChild(contentEl(ctx, 'div', 'kn-toggle-text', true));
    if (block.props.collapsed) wrapper.setAttribute('data-collapsed', 'true');
    return wrapper;
  };
  toggle.update = (main, _prev, next) => {
    const arrow = main.querySelector<HTMLElement>('[data-toggle-arrow]');
    if (!arrow) return false;
    const collapsed = Boolean(next.props.collapsed);
    arrow.textContent = collapsed ? '▸' : '▾';
    arrow.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (collapsed) main.setAttribute('data-collapsed', 'true');
    else main.removeAttribute('data-collapsed');
    return true;
  };
  toggle.toHTML = (_block, inner, childrenHTML) => `<details open><summary>${inner}</summary>${childrenHTML}</details>`;
  toggle.toMarkdown = (_block, inner, childrenMd) => `- ${inner}\n${childrenMd}`;
  registry.register(toggle);

  registry.register(
    simpleTextBlock({
      type: 'quote',
      label: '引言',
      description: '引用區塊',
      iconName: 'quote',
      keywords: ['quote', 'blockquote', '引言', '引用'],
      sortOrder: 90,
      tag: 'div',
      className: 'kn-quote',
      placeholder: '引用內容',
      exitInto: 'paragraph',
      htmlTag: 'blockquote',
      mdPrefix: '> ',
      markdownShortcut: [{ pattern: new RegExp(`^[>\\uff1e]${FW}$`) }],
    }),
  );

  // ── callout：icon + 內容 ──
  const callout = simpleTextBlock({
    type: 'callout',
    label: '標註框',
    description: '帶圖示的強調區塊',
    iconName: 'callout',
    keywords: ['callout', 'note', 'info', '標註', '提示', '強調'],
    sortOrder: 100,
    tag: 'div',
    className: 'kn-callout-text',
    placeholder: '標註內容',
    exitInto: 'paragraph',
    markdownShortcut: [{ pattern: new RegExp(`^[|\\uff5c]${FW}$`) }],
  });
  callout.defaultProps = { icon: '💡', color: 'default' };
  callout.validateProps = (props) => {
    const p = (props ?? {}) as { icon?: unknown; color?: unknown };
    return { icon: typeof p.icon === 'string' ? p.icon : '💡', color: typeof p.color === 'string' ? p.color : 'default' };
  };
  callout.render = (block, ctx) => {
    const wrapper = el(ctx.doc, 'div', { class: 'kn-callout', 'data-color': String(block.props.color ?? 'default') });
    const icon = el(ctx.doc, 'span', { class: 'kn-callout-icon', contenteditable: 'false', 'data-callout-icon': 'true' });
    icon.textContent = typeof block.props.icon === 'string' ? block.props.icon : '💡';
    wrapper.appendChild(icon);
    wrapper.appendChild(contentEl(ctx, 'div', 'kn-callout-text', true));
    return wrapper;
  };
  callout.update = (main, _prev, next) => {
    const icon = main.querySelector<HTMLElement>('[data-callout-icon]');
    if (!icon) return false;
    icon.textContent = typeof next.props.icon === 'string' ? next.props.icon : '💡';
    main.setAttribute('data-color', String(next.props.color ?? 'default'));
    return true;
  };
  callout.toHTML = (_block, inner, childrenHTML) => `<blockquote class="callout">${inner}</blockquote>${childrenHTML}`;
  callout.toMarkdown = (_block, inner, childrenMd) => `> ${inner}\n${childrenMd}`;
  registry.register(callout);

  // ── divider ──
  registry.register({
    type: 'divider',
    label: '分隔線',
    description: '水平分隔線',
    iconName: 'divider',
    group: 'basic',
    keywords: ['divider', 'hr', 'line', '分隔', '分隔線', '水平線'],
    sortOrder: 110,
    defaultProps: {},
    validateProps: () => ({}),
    canHaveChildren: false,
    hasInlineContent: false,
    editable: true,
    splitBehavior: 'none',
    markdownShortcut: [{ pattern: /^(-{3}|\*{3}|_{3})$/ }],
    render(_block, ctx) {
      return el(ctx.doc, 'div', { class: 'kn-divider', contenteditable: 'false' }, [el(ctx.doc, 'hr')]);
    },
    toHTML: () => '<hr>',
    toMarkdown: () => '---\n',
  });

  // ── code ──
  const code: BlockDefinition = {
    type: 'code',
    label: '程式碼',
    description: '等寬字型的程式碼區塊',
    iconName: 'code',
    group: 'advanced',
    keywords: ['code', 'snippet', '程式碼', '程式', '代碼'],
    sortOrder: 120,
    defaultProps: { language: 'plain' },
    validateProps: (props) => ({
      language: typeof (props as { language?: unknown } | null)?.language === 'string' ? (props as { language: string }).language : 'plain',
    }),
    canHaveChildren: false,
    hasInlineContent: true,
    editable: true,
    splitBehavior: 'none', // Enter 在 code block 內是軟換行
    placeholder: '輸入程式碼',
    markdownShortcut: [
      {
        pattern: /^```([a-zA-Z0-9+#.-]*)$/,
        getProps: (m) => ({ language: m[1] && m[1].length > 0 ? m[1] : 'plain' }),
      },
    ],
    render(block, ctx) {
      const pre = el(ctx.doc, 'pre', { class: 'kn-code', 'data-language': String(block.props.language ?? 'plain') });
      const inner = contentEl(ctx, 'code', 'kn-code-content', true);
      pre.appendChild(inner);
      return pre;
    },
    update(main, _prev, next) {
      main.setAttribute('data-language', String(next.props.language ?? 'plain'));
      return true;
    },
    toHTML(block, inner) {
      return `<pre><code class="language-${escapeAttr(String(block.props.language ?? 'plain'))}">${inner}</code></pre>`;
    },
    toMarkdown(block, inner) {
      return `\`\`\`${String(block.props.language ?? '')}\n${inner}\n\`\`\`\n`;
    },
  };
  registry.register(code);

  // ── 其餘型別：不可編輯的佔位 renderer ──
  const placeholders: [BlockType, string, string, BlockGroup, number][] = [
    ['image', '圖片', 'image', 'media', 200],
    ['file', '檔案', 'file', 'media', 210],
    ['bookmark', '網頁書籤', 'bookmark', 'media', 220],
    ['video', '影片', 'video', 'media', 230],
    ['embed', '嵌入', 'embed', 'embed', 240],
    ['equation', '數學公式', 'equation', 'advanced', 250],
    ['tableOfContents', '目錄', 'toc', 'advanced', 260],
    ['page', '子頁面', 'page', 'basic', 270],
    ['columnList', '欄位容器', 'columns', 'advanced', 280],
    ['column', '欄', 'column', 'advanced', 290],
    ['table', '表格', 'table', 'advanced', 300],
    ['tableRow', '表格列', 'table-row', 'advanced', 310],
    ['collectionView', '資料庫檢視', 'database', 'database', 320],
    ['audio', '音訊', 'audio', 'media', 205],
    ['pdf', 'PDF', 'pdf', 'media', 215],
    ['breadcrumb', '頁面路徑', 'breadcrumb', 'advanced', 330],
    ['button', '按鈕', 'button', 'advanced', 340],
    ['syncedBlock', '同步區塊', 'synced', 'advanced', 350],
  ];
  for (const [type, label, icon, group, sortOrder] of placeholders) {
    registry.register(placeholderDefinition(type, label, icon, group, sortOrder, [type, label]));
  }

  return registry;
}

/** 供 clipboard / 匯出使用：安全的連結 URL。 */
export { safeUrl };

/** 一段 RichText 的 plain text（給佔位 renderer 的 title 等用）。 */
export function blockPlainText(content: RichText): string {
  return toPlainText(content);
}
