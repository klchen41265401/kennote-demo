/**
 * DomView：把 EditorDoc 投影成 DOM 樹，並提供 block 層級的凍結機制。
 *
 * 更新策略：以 block id 為 key 做增量 reconcile。
 *  - 同 id 的 block → 交給 BlockView.update（內部再做 inline 的 key 化 diff）
 *  - 新增 / 刪除 / 搬移 → 只動到受影響的節點，不重建整棵樹
 */
import type { Block, EditorDoc } from '../model/types.js';
import type { BlockRegistry } from '../plugins/block-registry.js';
import { BlockView } from './block-view.js';
import type { RenderInlineOptions } from './dom-view.js';
import { el } from './dom-utils.js';

export interface ViewOptions {
  container: HTMLElement;
  registry: BlockRegistry;
  editable?: boolean;
  inline?: RenderInlineOptions;
}

export interface EditorView {
  getBlockEl(blockId: string): HTMLElement | null;
  getContentEl(blockId: string): HTMLElement | null;
  freeze(blockId: string): void;
  unfreeze(blockId: string): void;
  isFrozen(blockId: string): boolean;
}

export class DomView implements EditorView {
  readonly root: HTMLElement;
  private readonly container: HTMLElement;
  private readonly registry: BlockRegistry;
  private readonly doc: Document;
  private readonly editable: boolean;
  private readonly inline: RenderInlineOptions;
  private readonly views = new Map<string, BlockView>();
  private lastDoc: EditorDoc | null = null;

  constructor(options: ViewOptions) {
    this.container = options.container;
    this.doc = options.container.ownerDocument;
    this.registry = options.registry;
    this.editable = options.editable ?? true;
    this.inline = options.inline ?? {};
    this.root = el(this.doc, 'div', { class: 'kn-editor', 'data-kn-root': 'true' });
    this.container.appendChild(this.root);
  }

  render(doc: EditorDoc): void {
    this.reconcile(this.root, doc.rootIds, doc);
    // 清掉已不存在的 block view
    for (const [id, view] of [...this.views]) {
      if (!doc.blocks[id]) {
        view.destroy();
        this.views.delete(id);
      }
    }
    this.lastDoc = doc;
  }

  /** 只更新一個 block（輸入路徑的快路徑：不走整份 doc reconcile）。 */
  updateBlock(block: Block): void {
    const view = this.views.get(block.id);
    if (view) view.update(block);
  }

  /**
   * 用「索引」而不是「游標節點」定位。
   * 巢狀 reconcile 可能把某個節點搬到別的 parent 底下（例如貼上一棵有子層的子樹），
   * 這時舊的游標節點已經不是 parentEl 的小孩，insertBefore 會丟 NotFoundError。
   */
  private reconcile(parentEl: HTMLElement, ids: string[], doc: EditorDoc): void {
    let pos = 0;
    for (const id of ids) {
      const block = doc.blocks[id];
      if (!block) continue;
      let view = this.views.get(id);
      if (!view) {
        view = new BlockView(this.doc, block, { registry: this.registry, editable: this.editable, inline: this.inline });
        this.views.set(id, view);
      } else {
        view.update(block);
      }
      const current: ChildNode | null = parentEl.childNodes[pos] ?? null;
      if (current !== view.element) parentEl.insertBefore(view.element, current);
      pos += 1;
      this.reconcile(view.childrenEl, block.children, doc);
    }
    // 移除這一層多餘的節點（對應的 BlockView 會在 render() 尾端一併清掉）
    while (parentEl.childNodes.length > pos) parentEl.removeChild(parentEl.lastChild!);
  }

  getBlockEl(blockId: string): HTMLElement | null {
    return this.views.get(blockId)?.element ?? null;
  }

  getContentEl(blockId: string): HTMLElement | null {
    return this.views.get(blockId)?.content ?? null;
  }

  getBlockView(blockId: string): BlockView | null {
    return this.views.get(blockId) ?? null;
  }

  /** IME 組字期間凍結某個 block 的重繪。 */
  freeze(blockId: string): void {
    this.views.get(blockId)?.freeze();
  }

  unfreeze(blockId: string): void {
    this.views.get(blockId)?.unfreeze();
  }

  isFrozen(blockId: string): boolean {
    return this.views.get(blockId)?.isFrozen ?? false;
  }

  /** 組字結束時：DOM 已經是對的，只更新 BlockView 內部的 model 參考。 */
  adopt(block: Block): void {
    this.views.get(block.id)?.adopt(block);
  }

  /** 對帳失敗時的最後手段：以 model 為準強制重畫該 block。 */
  forceRender(blockId: string): void {
    this.views.get(blockId)?.forceRender();
  }

  get currentDoc(): EditorDoc | null {
    return this.lastDoc;
  }

  destroy(): void {
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    this.root.remove();
  }
}
