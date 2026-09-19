/**
 * 每個 block 一個獨立的 contenteditable 容器（04 §4.1 路線 B/C）。
 *
 *   <div class="kn-block kn-block--paragraph" data-block-id="b1">
 *     <div class="kn-block-main">        ← 由 BlockDefinition.render 產生
 *       <div class="kn-block-content" contenteditable="true" data-block-content>…</div>
 *     </div>
 *     <div class="kn-block-children">…子 block…</div>
 *   </div>
 *
 * freeze()：IME 組字期間凍結這個 block 的重繪。期間任何 model 變更都不得碰它的 DOM。
 */
import type { Block } from '../model/types.js';
import type { BlockDefinition, BlockRegistry, RenderCtx } from '../plugins/block-registry.js';
import { BLOCK_ID_ATTR, getContentEl } from '../selection/dom-mapper.js';
import { renderInline, type RenderInlineOptions } from './dom-view.js';
import { el } from './dom-utils.js';

export interface BlockViewOptions {
  registry: BlockRegistry;
  editable: boolean;
  inline?: RenderInlineOptions;
}

export class BlockView {
  readonly blockId: string;
  readonly root: HTMLElement;
  readonly childrenEl: HTMLElement;
  private main: HTMLElement;
  private contentEl: HTMLElement | null;
  private def: BlockDefinition;
  private block: Block;
  private readonly doc: Document;
  private readonly options: BlockViewOptions;
  private frozen = false;
  /** 凍結期間錯過的更新，解凍時補上。 */
  private pending: Block | null = null;

  constructor(doc: Document, block: Block, options: BlockViewOptions) {
    this.doc = doc;
    this.block = block;
    this.blockId = block.id;
    this.options = options;
    this.def = options.registry.get(block.type);

    this.root = el(doc, 'div', {
      class: `kn-block kn-block--${block.type}`,
      [BLOCK_ID_ATTR]: block.id,
      'data-block-type': block.type,
    });
    this.main = this.renderMain(block);
    this.childrenEl = el(doc, 'div', { class: 'kn-block-children' });
    this.root.appendChild(this.main);
    this.root.appendChild(this.childrenEl);
    this.contentEl = getContentEl(this.root);
    this.renderContent(block);
  }

  private ctx(): RenderCtx {
    return { doc: this.doc, editable: this.options.editable && this.def.editable };
  }

  private renderMain(block: Block): HTMLElement {
    const main = this.def.render(block, this.ctx());
    main.classList.add('kn-block-main');
    return main;
  }

  private renderContent(block: Block): void {
    if (!this.contentEl) return;
    const inline: RenderInlineOptions = { ...this.options.inline };
    if (this.def.placeholder !== undefined) inline.placeholder = this.def.placeholder;
    renderInline(this.contentEl, block.content, inline);
  }

  get element(): HTMLElement {
    return this.root;
  }

  get content(): HTMLElement | null {
    return this.contentEl;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  get model(): Block {
    return this.block;
  }

  /** IME 組字期間凍結重繪。 */
  freeze(): void {
    this.frozen = true;
  }

  unfreeze(): void {
    this.frozen = false;
    const pending = this.pending;
    this.pending = null;
    if (pending) this.update(pending);
  }

  /** 組字結束後，model 已經與 DOM 一致 → 只更新內部參考，不碰 DOM。 */
  adopt(block: Block): void {
    this.block = block;
  }

  update(block: Block): void {
    if (this.frozen) {
      this.pending = block;
      return;
    }
    const prev = this.block;
    this.block = block;

    if (prev.type !== block.type) {
      this.def = this.options.registry.get(block.type);
      const next = this.renderMain(block);
      this.root.replaceChild(next, this.main);
      this.main = next;
      this.root.className = `kn-block kn-block--${block.type}`;
      this.root.setAttribute(BLOCK_ID_ATTR, block.id);
      this.root.setAttribute('data-block-type', block.type);
      this.contentEl = getContentEl(this.root);
      this.renderContent(block);
      return;
    }

    if (prev.props !== block.props && this.def.update) {
      const ok = this.def.update(this.main, prev, block);
      if (!ok) {
        const next = this.renderMain(block);
        this.root.replaceChild(next, this.main);
        this.main = next;
        this.contentEl = getContentEl(this.root);
      }
    }
    if (prev.content !== block.content) this.renderContent(block);
  }

  /** 重新把 model 投影到 DOM（對帳用）。 */
  forceRender(): void {
    this.renderContent(this.block);
  }

  destroy(): void {
    this.root.remove();
  }
}
