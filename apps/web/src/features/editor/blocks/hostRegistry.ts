/**
 * 把「前端 BlockSpec」縫到 editor-core 的 BlockRegistry 上。
 *
 * editor-core 不認識 React，所以這裡做兩件事：
 *   1. 需要 React 畫的型別 → 覆寫 render()，只產生一個**穩定的空容器**
 *      （`[data-kn-react-block]`），BlockPortals 再把 React 元件 portal 進去。
 *      update() 一律回 true，代表「不要重建這個 DOM 節點」——容器一旦被換掉，
 *      React portal 就會整個重掛，狀態（例如上傳進度）會消失。
 *   2. 需要額外 chrome 的可編輯型別（code、清單 marker）→ 在 editor-core 的
 *      渲染結果旁加一個 `[data-kn-react-slot]` 掛載點，行內內容仍由 editor-core 管。
 *
 * 一條紅線：這裡產生的容器**只是掛載點**，不放任何資料；資料一律來自 model。
 */
import {
  BLOCK_CONTENT_ATTR,
  createDefaultRegistry,
  el,
  type BlockDefinition,
  type BlockRegistry,
  type BlockType,
  type RenderCtx,
} from '@kennote/editor-core';
import { getSpec, listSpecs } from './registry';

export const REACT_BLOCK_ATTR = 'data-kn-react-block';
export const REACT_SLOT_ATTR = 'data-kn-react-slot';

function contentEl(ctx: RenderCtx, tag: keyof HTMLElementTagNameMap, className: string): HTMLElement {
  const node = el(ctx.doc, tag, { class: `kn-block-content ${className}`, [BLOCK_CONTENT_ATTR]: 'true' });
  if (ctx.editable) {
    node.setAttribute('contenteditable', 'true');
    node.setAttribute('role', 'textbox');
    node.setAttribute('aria-multiline', 'false');
    node.setAttribute('spellcheck', 'false');
  }
  return node;
}

function reactContainer(ctx: RenderCtx, type: BlockType, className: string): HTMLElement {
  return el(ctx.doc, 'div', {
    class: className,
    contenteditable: 'false',
    [REACT_BLOCK_ATTR]: type,
  });
}

/** 完全由 React 畫的 block：editor-core 只給一個空容器 */
function reactHosted(base: BlockDefinition, type: BlockType, canHaveChildren: boolean): BlockDefinition {
  const spec = getSpec(type);
  return {
    ...base,
    label: spec?.label ?? base.label,
    description: spec?.description ?? base.description,
    iconName: spec?.icon ?? base.iconName,
    group: spec?.group ?? base.group,
    keywords: spec?.keywords ?? base.keywords,
    sortOrder: spec?.sortOrder ?? base.sortOrder,
    defaultProps: spec?.defaultProps ?? base.defaultProps,
    canHaveChildren,
    hasInlineContent: false,
    editable: false,
    splitBehavior: 'none',
    validateProps: (props) => (props && typeof props === 'object' ? { ...(props as Record<string, unknown>) } : {}),
    render(_block, ctx) {
      return reactContainer(ctx, type, `kn-react-block kn-react-block--${type}`);
    },
    // props 變了讓 React 重畫就好，DOM 容器必須保持同一個節點
    update() {
      return true;
    },
  };
}


/**
 * 把 `props.color`（03 §6.2 的 block_color）寫成 main 元素的 `data-color`。
 *
 * 為什麼要包一層：editor-core 的 BlockView 只有在 `def.update` 存在時才會在
 * props 變動時做事；沒有 update 的定義改了顏色不會重繪。包一層同時解決
 * 「顏色要渲染」與「props 變動要有 update 掛勾」兩件事。
 */
function applyColor(main: HTMLElement, block: { props: Record<string, unknown> }): void {
  const color = typeof block.props.color === 'string' ? block.props.color : '';
  if (color && color !== 'default') main.setAttribute('data-color', color);
  else main.removeAttribute('data-color');
}

function withColor(def: BlockDefinition): BlockDefinition {
  const baseRender = def.render;
  const baseUpdate = def.update;
  return {
    ...def,
    render(block, ctx) {
      const main = baseRender.call(def, block, ctx);
      applyColor(main, block);
      return main;
    },
    update(main, prev, next) {
      applyColor(main, next);
      return baseUpdate ? baseUpdate.call(def, main, prev, next) : true;
    },
  };
}

export function createHostRegistry(): BlockRegistry {
  const registry = createDefaultRegistry();

  /* ── 1. React 掛載容器 ─────────────────────────────── */
  const reactTypes: BlockType[] = [
    'image',
    'file',
    'video',
    'bookmark',
    'embed',
    'equation',
    'tableOfContents',
    'page',
    'table',
    'collectionView',
    'audio',
    'pdf',
    'breadcrumb',
    'button',
    'syncedBlock',
  ];
  const WITH_CHILDREN = new Set<BlockType>(['table', 'syncedBlock']);
  for (const type of reactTypes) {
    registry.override(reactHosted(registry.get(type), type, WITH_CHILDREN.has(type)));
  }

  /* ── 2. 版面容器：children 由 editor-core 遞迴渲染 ─── */
  const columnList = registry.get('columnList');
  registry.override({
    ...columnList,
    label: '多欄版面',
    canHaveChildren: true,
    hasInlineContent: false,
    editable: false,
    splitBehavior: 'none',
    render(_block, ctx) {
      return el(ctx.doc, 'div', { class: 'kn-column-list', contenteditable: 'false' });
    },
    update() {
      return true;
    },
  });

  const column = registry.get('column');
  registry.override({
    ...column,
    label: '欄',
    canHaveChildren: true,
    hasInlineContent: false,
    editable: false,
    splitBehavior: 'none',
    defaultProps: { ratio: 0.5 },
    render(_block, ctx) {
      return reactContainer(ctx, 'column', 'kn-column-main');
    },
    update() {
      return true;
    },
  });

  // tableRow 的視覺由 table 的 React renderer 一次畫完，這裡只保留模型節點
  const tableRow = registry.get('tableRow');
  registry.override({
    ...tableRow,
    canHaveChildren: false,
    hasInlineContent: false,
    editable: false,
    splitBehavior: 'none',
    render(_block, ctx) {
      return el(ctx.doc, 'div', { class: 'kn-table-row-model', contenteditable: 'false', hidden: 'true' });
    },
    update() {
      return true;
    },
  });

  /* ── 3. 清單 marker（序號用 CSS counter 算，不存在資料裡）─ */
  for (const type of ['bulletedList', 'numberedList'] as const) {
    const base = registry.get(type);
    const markerClass = type === 'bulletedList' ? 'kn-list-marker--bullet' : 'kn-list-marker--number';
    registry.override({
      ...base,
      render(_block, ctx) {
        const wrapper = el(ctx.doc, 'div', { class: `kn-list kn-list--${type}` });
        wrapper.appendChild(
          el(ctx.doc, 'span', { class: `kn-list-marker ${markerClass}`, contenteditable: 'false', 'aria-hidden': 'true' }),
        );
        wrapper.appendChild(contentEl(ctx, 'div', 'kn-list-text'));
        return wrapper;
      },
      update() {
        return true;
      },
    });
  }

  /* ── 4. code：加一個 React chrome 掛載點 ──────────── */
  const code = registry.get('code');
  registry.override({
    ...code,
    render(block, ctx) {
      const wrapper = el(ctx.doc, 'div', {
        class: 'kn-code-block',
        'data-language': String(block.props.language ?? 'plain'),
        'data-wrap': block.props.wrap ? 'true' : 'false',
        'data-line-numbers': block.props.lineNumbers ? 'true' : 'false',
      });
      wrapper.appendChild(
        el(ctx.doc, 'div', { class: 'kn-code-slot', contenteditable: 'false', [REACT_SLOT_ATTR]: 'code' }),
      );
      const pre = el(ctx.doc, 'pre', { class: 'kn-code-pre' });
      pre.appendChild(contentEl(ctx, 'code', 'kn-code-content'));
      wrapper.appendChild(pre);
      return wrapper;
    },
    update(main, _prev, next) {
      main.setAttribute('data-language', String(next.props.language ?? 'plain'));
      main.setAttribute('data-wrap', next.props.wrap ? 'true' : 'false');
      main.setAttribute('data-line-numbers', next.props.lineNumbers ? 'true' : 'false');
      return true;
    },
  });

  /* ── 5. 把前端 spec 的文案 / 關鍵字同步到 editor-core registry ── */
  for (const spec of listSpecs()) {
    if (!registry.has(spec.type)) continue;
    const def = registry.get(spec.type);
    if (def.label === spec.label && def.keywords === spec.keywords) continue;
    registry.override({
      ...def,
      label: spec.label,
      description: spec.description,
      iconName: spec.icon,
      group: spec.group,
      keywords: [...spec.keywords, spec.labelEn],
      sortOrder: spec.sortOrder,
    });
  }

  /* ── 6. 最後一道：所有型別都支援 block color ──────── */
  for (const def of registry.list()) registry.override(withColor(def));

  return registry;
}

/** 取得某個 block 的 React 掛載點（portal target） */
export function findMountPoint(blockEl: HTMLElement | null): { el: HTMLElement; kind: 'block' | 'slot' } | null {
  if (!blockEl) return null;
  const main = blockEl.firstElementChild;
  if (!(main instanceof HTMLElement)) return null;
  if (main.hasAttribute(REACT_BLOCK_ATTR)) return { el: main, kind: 'block' };
  const nested = main.querySelector<HTMLElement>(`[${REACT_BLOCK_ATTR}], [${REACT_SLOT_ATTR}]`);
  if (nested) return { el: nested, kind: nested.hasAttribute(REACT_BLOCK_ATTR) ? 'block' : 'slot' };
  return null;
}
