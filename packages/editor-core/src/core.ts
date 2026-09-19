/**
 * Editor —— editor-core 的門面（facade）。
 *
 * 宿主（React）只需要：
 *   const editor = createEditor({ container, doc });
 *   editor.on('localOps', ops => sync.submit(ops));
 *   ... editor.destroy();
 *
 * 內部組裝：model → transaction → view → selection → input → history → clipboard。
 * 唯一的變更入口是 applyTransaction()；沒有任何路徑可以偷改 doc。
 */
import type { Block, BlockType, DocFragment, EditorDoc, Mark, RichText } from './model/types.js';
import { createId, flattenDoc } from './model/document.js';
import { length as rtLength, marksAt, normalize } from './text/richtext.js';
import { diffRichText } from './text/diff.js';
import type { Operation } from './transaction/operation.js';
import { applyOps, OperationError } from './transaction/apply.js';
import { invertOps } from './transaction/invert.js';
import { createTransaction, type Transaction, type TransactionInput, type TransactionSource } from './transaction/transaction.js';
import {
  defaultBuilderContext,
  deleteBlocksOps,
  insertBlockAfterOps,
  moveBlockOps,
  setBlockTypeOps,
  toggleMarkOps,
  type BuilderContext,
  type BuildResult,
} from './transaction/builders.js';
import type { EditorSelection } from './selection/types.js';
import { NO_SELECTION, orderedRange, textSelection } from './selection/types.js';
import { SelectionManager } from './selection/manager.js';
import { BlockSelectionController, paintBlockSelection } from './selection/block-selection.js';
import { DomView } from './view/view.js';
import { BlockRegistry, createDefaultRegistry } from './plugins/block-registry.js';
import type { EditorPlugin, PluginContext } from './plugins/types.js';
import { HistoryStack, type HistoryOptions } from './history/stack.js';
import { InputController } from './input/controller.js';
import type { RenderInlineOptions } from './view/dom-view.js';

export interface EditorEventMap {
  /** 每一次成功套用的 transaction。 */
  transaction: (tx: Transaction, doc: EditorDoc) => void;
  /** 本地產生、需要送往同步層的 operation（不含 remote 來源）。 */
  localOps: (ops: Operation[], tx: Transaction) => void;
  selectionChange: (sel: EditorSelection) => void;
  compositionChange: (isComposing: boolean) => void;
  /** 輸入 '/' 時給宿主開選單。 */
  slashTrigger: (payload: MenuTriggerPayload) => void;
  /** 輸入 '@' 時給宿主開 mention 選單。 */
  mentionTrigger: (payload: MenuTriggerPayload) => void;
  /** 宿主開啟 block 操作選單（拖曳把手 / 右鍵）。 */
  blockMenu: (payload: { blockId: string; rect: DOMRect | null }) => void;
  /** 任何會讓 DOM 與 model 不一致的情況（開發期該為零）。 */
  reconcile: (payload: { blockId: string; reason: string; dom?: unknown; model?: unknown; mutations?: string[] }) => void;
}

export interface MenuTriggerPayload {
  open: boolean;
  blockId: string;
  /** 觸發字元（'/' 或 '@'）所在的 offset。 */
  triggerOffset: number;
  query: string;
  rect: DOMRect | null;
}

export interface CreateEditorOptions {
  container: HTMLElement;
  doc?: EditorDoc;
  blockRegistry?: BlockRegistry;
  plugins?: EditorPlugin[];
  editable?: boolean;
  history?: HistoryOptions;
  inline?: RenderInlineOptions;
  /** 可注入假 id 產生器，讓測試結果穩定。 */
  newId?: () => string;
  /** 可注入假時鐘。 */
  now?: () => number;
}

type Listener = (...args: never[]) => void;

export class Editor {
  readonly registry: BlockRegistry;
  readonly view: DomView;
  readonly selection: SelectionManager;
  readonly history: HistoryStack;
  readonly blockSelection: BlockSelectionController;
  readonly builderCtx: BuilderContext;
  readonly newId: () => string;
  readonly now: () => number;
  readonly container: HTMLElement;

  private doc: EditorDoc;
  private readonly listeners = new Map<keyof EditorEventMap, Set<Listener>>();
  private readonly plugins: EditorPlugin[];
  private readonly pluginCleanups: (() => void)[] = [];
  private readonly input: InputController;
  private remoteQueue: Operation[] = [];
  private destroyed = false;

  constructor(options: CreateEditorOptions) {
    this.container = options.container;
    this.registry = options.blockRegistry ?? createDefaultRegistry();
    this.newId = options.newId ?? createId;
    this.now = options.now ?? (() => Date.now());
    this.doc = normalizeDoc(options.doc ?? createEmptyDoc(this.newId));
    this.plugins = options.plugins ?? [];

    this.builderCtx = {
      hasInlineContent: (type) => this.registry.get(type).hasInlineContent,
      canHaveChildren: (type) => this.registry.get(type).canHaveChildren,
      splitType: (type) => this.registry.get(type).splitInto ?? (this.registry.get(type).splitBehavior === 'split' ? type : 'paragraph'),
      exitType: (type) => this.registry.get(type).exitInto ?? null,
      newId: this.newId,
    };

    const viewOptions: { container: HTMLElement; registry: BlockRegistry; editable: boolean; inline?: RenderInlineOptions } = {
      container: options.container,
      registry: this.registry,
      editable: options.editable ?? true,
    };
    if (options.inline) viewOptions.inline = options.inline;
    this.view = new DomView(viewOptions);
    this.view.render(this.doc);

    const historyOptions: HistoryOptions = { ...options.history };
    if (!historyOptions.now) historyOptions.now = this.now;
    this.history = new HistoryStack(historyOptions);

    this.selection = new SelectionManager({
      root: this.view.root,
      view: this.view,
      isComposing: () => this.isComposing,
      onChange: (sel) => {
        paintBlockSelection(this.view.root, sel);
        this.emit('selectionChange', sel);
        for (const plugin of this.plugins) plugin.onSelectionChange?.(sel, this.pluginContext());
      },
    });

    this.blockSelection = new BlockSelectionController({
      root: this.view.root,
      getDoc: () => this.doc,
      getSelection: () => this.selection.value,
      setSelection: (sel) => {
        this.selection.setModel(sel);
        paintBlockSelection(this.view.root, sel);
      },
      clearNativeSelection: () => {
        const documentRef = this.view.root.ownerDocument;
        documentRef.getSelection()?.removeAllRanges();
        const active = documentRef.activeElement;
        if (active instanceof HTMLElement && this.view.root.contains(active)) active.blur();
      },
    });

    this.input = new InputController(this);
    this.input.attach();
    this.blockSelection.attach();

    for (const plugin of this.plugins) {
      const cleanup = plugin.setup?.(this.pluginContext());
      if (typeof cleanup === 'function') this.pluginCleanups.push(cleanup);
    }
  }

  // ── 狀態查詢 ─────────────────────────────────────────────

  getDoc(): EditorDoc {
    return this.doc;
  }

  getBlock(blockId: string): Block | undefined {
    return this.doc.blocks[blockId];
  }

  get isComposing(): boolean {
    return this.input?.isComposing ?? false;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  getSelection(): EditorSelection {
    return this.selection.value;
  }

  setSelection(sel: EditorSelection): void {
    if (sel.type === 'text') this.selection.write(sel);
    else {
      this.selection.setModel(sel);
      paintBlockSelection(this.view.root, sel);
      if (sel.type === 'block') {
        this.view.root.ownerDocument.getSelection()?.removeAllRanges();
      }
    }
  }

  getSelectionRect(): DOMRect | null {
    return this.selection.getSelectionRect();
  }

  /** 目前選取範圍共同擁有的 marks（浮動工具列按鈕狀態）。 */
  getActiveMarks(): Mark[] {
    const range = orderedRange(this.selection.value);
    if (!range) return [];
    const block = this.doc.blocks[range.blockId];
    if (!block) return [];
    return marksAt(block.content, range.start, range.end);
  }

  // ── 變更入口 ─────────────────────────────────────────────

  /** 唯一的變更入口。 */
  applyTransaction(tx: Transaction): boolean {
    if (this.destroyed) return false;
    let current: Transaction | null = tx;
    for (const plugin of this.plugins) {
      if (!current) break;
      if (plugin.filterTransaction) current = plugin.filterTransaction(current, this.pluginContext());
    }
    if (!current || current.ops.length === 0) return false;

    let nextDoc: EditorDoc;
    try {
      nextDoc = applyOps(this.doc, current.ops);
    } catch (error) {
      if (error instanceof OperationError) {
        // 原子性：整批不套用
        console.warn('[editor-core] transaction rejected:', error.message);
        return false;
      }
      throw error;
    }

    const prevDoc = this.doc;
    this.doc = nextDoc;

    if (!current.skipRender) this.applyToView(prevDoc, current);
    else for (const id of current.blockIds) this.view.adopt(this.doc.blocks[id] ?? prevDoc.blocks[id]!);

    if (current.source === 'user' || current.source === 'ime' || current.source === 'paste') {
      this.history.record(current);
    }

    if (current.selectionAfter.type !== 'none') this.setSelection(current.selectionAfter);

    this.emit('transaction', current, this.doc);
    if (current.source !== 'remote') this.emit('localOps', current.ops, current);
    for (const plugin of this.plugins) plugin.onTransaction?.(current, this.pluginContext());
    return true;
  }

  /** 便利方法：從 ops 建 transaction 並套用。 */
  dispatch(input: Omit<TransactionInput, 'selectionBefore' | 'selectionAfter'> & {
    selectionBefore?: EditorSelection;
    selectionAfter?: EditorSelection;
  }): boolean {
    if (input.ops.length === 0) return false;
    const txInput: TransactionInput = {
      ...input,
      selectionBefore: input.selectionBefore ?? this.selection.value,
      selectionAfter: input.selectionAfter ?? this.selection.value,
      timestamp: input.timestamp ?? this.now(),
    };
    let tx: Transaction;
    try {
      // invertOps 會在中間狀態上試跑一次 ops，不合法的批次在這裡就會被擋下（原子性）
      tx = createTransaction(this.doc, txInput);
    } catch (error) {
      if (error instanceof OperationError) {
        console.warn('[editor-core] transaction rejected while inverting:', error.message);
        return false;
      }
      throw error;
    }
    return this.applyTransaction(tx);
  }

  /** 把 builder 的結果直接派送。 */
  dispatchBuild(result: BuildResult | null, options?: Partial<TransactionInput>): boolean {
    if (!result || result.ops.length === 0) return false;
    return this.dispatch({ ...options, ops: result.ops, selectionAfter: result.selectionAfter });
  }

  /** 套用遠端 operation：不進 undo stack、不廣播回同步層。 */
  applyRemote(ops: Operation[]): boolean {
    if (ops.length === 0) return false;
    // IME 組字期間：排隊等解凍（組字中改 DOM 會讓輸入法崩掉）
    if (this.isComposing) {
      this.remoteQueue.push(...ops);
      return false;
    }
    const before = this.doc;
    const selectionBefore = this.selection.value;
    const tx = createTransaction(this.doc, {
      ops,
      selectionBefore,
      selectionAfter: selectionBefore,
      source: 'remote',
      timestamp: this.now(),
    });
    const ok = this.applyTransactionRemote(tx, before, selectionBefore);
    this.history.onRemoteOps(ops);
    return ok;
  }

  private applyTransactionRemote(tx: Transaction, before: EditorDoc, selectionBefore: EditorSelection): boolean {
    const applied = this.applyTransactionInternalRemote(tx);
    if (!applied) return false;
    // 注意：block 被別人刪掉時 rebaseSelection 會回傳 none，這時也要真的清掉選取
    this.setSelection(rebaseSelection(before, this.doc, selectionBefore));
    return true;
  }

  private applyTransactionInternalRemote(tx: Transaction): boolean {
    // 遠端 tx 的 selectionAfter 不該覆蓋本地游標，先設成 none 再套用
    const neutral: Transaction = { ...tx, selectionAfter: NO_SELECTION };
    return this.applyTransaction(neutral);
  }

  /** 解除 IME 凍結後，把排隊的遠端 ops 沖出去。 */
  flushRemoteQueue(): void {
    if (this.remoteQueue.length === 0) return;
    const queued = this.remoteQueue;
    this.remoteQueue = [];
    this.applyRemote(queued);
  }

  get pendingRemoteOps(): number {
    return this.remoteQueue.length;
  }

  // ── 常用命令 ─────────────────────────────────────────────

  undo(): boolean {
    const entry = this.history.popUndo();
    if (!entry) return false;
    const tx = createTransaction(this.doc, {
      ops: entry.inverseOps,
      selectionBefore: entry.selectionAfter,
      selectionAfter: entry.selectionBefore,
      source: 'history',
      kind: entry.kind,
      timestamp: this.now(),
    });
    return this.applyTransaction(tx);
  }

  redo(): boolean {
    const entry = this.history.popRedo();
    if (!entry) return false;
    const tx = createTransaction(this.doc, {
      ops: entry.ops,
      selectionBefore: entry.selectionBefore,
      selectionAfter: entry.selectionAfter,
      source: 'history',
      kind: entry.kind,
      timestamp: this.now(),
    });
    return this.applyTransaction(tx);
  }

  focusBlock(blockId: string, offset = 0): void {
    const block = this.doc.blocks[blockId];
    if (!block) return;
    const max = rtLength(block.content);
    this.selection.write(textSelection(blockId, Math.max(0, Math.min(offset, max))));
  }

  toggleMark(mark: Mark): boolean {
    const range = orderedRange(this.selection.value);
    if (!range || range.start === range.end) return false;
    this.history.breakpoint();
    return this.dispatchBuild(toggleMarkOps(this.doc, range.blockId, range.start, range.end, mark), {
      kind: 'format',
      breakHistory: true,
    });
  }

  setBlockType(blockIds: string | string[], type: BlockType, props?: Record<string, unknown>): boolean {
    const ids = Array.isArray(blockIds) ? blockIds : [blockIds];
    if (ids.length === 0) return false;
    const def = this.registry.get(type);
    const nextProps = props ?? def.defaultProps;
    this.history.breakpoint();
    const selectionAfter = this.selection.value.type === 'text' ? this.selection.value : textSelection(ids[0]!, 0);
    return this.dispatchBuild(setBlockTypeOps(this.doc, ids, type, nextProps, selectionAfter), {
      kind: 'structural',
      breakHistory: true,
    });
  }

  insertBlockAfter(afterId: string | null, options?: { type?: BlockType; props?: Record<string, unknown>; content?: RichText; asChild?: boolean }): string | null {
    const id = this.newId();
    const built = insertBlockAfterOps(this.doc, afterId, { ...options, id });
    this.history.breakpoint();
    const ok = this.dispatchBuild(built, { kind: 'structural', breakHistory: true });
    return ok ? id : null;
  }

  deleteBlocks(blockIds: string[]): boolean {
    if (blockIds.length === 0) return false;
    this.history.breakpoint();
    return this.dispatchBuild(deleteBlocksOps(this.doc, blockIds), { kind: 'structural', breakHistory: true });
  }

  moveBlock(blockId: string, parentId: string | null, afterId: string | null): boolean {
    this.history.breakpoint();
    return this.dispatchBuild(moveBlockOps(this.doc, blockId, parentId, afterId), {
      kind: 'structural',
      breakHistory: true,
      selectionAfter: this.selection.value,
    });
  }

  /**
   * 測試用：跳過 requestAnimationFrame 直接結束 composition。
   * 正式使用時不需要呼叫（compositionend 會自己排一個 frame）。
   */
  finishCompositionForTest(): void {
    this.input.finishComposition();
  }

  /** 測試／開發期監控：MutationObserver 的對帳觸發次數。正常操作應該永遠是 0。 */
  get mutationTriggerCountForTest(): number {
    return this.input.mutationTriggerCount;
  }

  /** 取得目前選取的內容片段（複製用）。 */
  getSelectedFragment(): DocFragment | null {
    return this.input.getSelectedFragment();
  }

  /** 把一個片段插入目前選取處（貼上用）。 */
  insertFragment(fragment: DocFragment): boolean {
    return this.input.insertFragment(fragment);
  }

  // ── 事件 ─────────────────────────────────────────────────

  on<K extends keyof EditorEventMap>(event: K, cb: EditorEventMap[K]): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb as Listener);
    return () => {
      set?.delete(cb as Listener);
    };
  }

  off<K extends keyof EditorEventMap>(event: K, cb: EditorEventMap[K]): void {
    this.listeners.get(event)?.delete(cb as Listener);
  }

  emit<K extends keyof EditorEventMap>(event: K, ...args: Parameters<EditorEventMap[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as (...a: unknown[]) => void)(...args);
      } catch (error) {
        console.error(`[editor-core] listener for "${String(event)}" threw:`, error);
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const cleanup of this.pluginCleanups) cleanup();
    this.pluginCleanups.length = 0;
    this.input.detach();
    this.blockSelection.detach();
    this.selection.destroy();
    this.view.destroy();
    this.listeners.clear();
  }

  // ── 內部 ─────────────────────────────────────────────────

  private pluginContext(): PluginContext {
    return {
      getDoc: () => this.doc,
      getSelection: () => this.selection.value,
      applyTransaction: (tx) => {
        this.applyTransaction(tx);
      },
    };
  }

  /** 決定要走「只更新受影響的 block」還是整份 reconcile。 */
  private applyToView(prevDoc: EditorDoc, tx: Transaction): void {
    const structural = tx.ops.some((op) => op.type !== 'block.update' && op.type !== 'text.delta');
    const typeChanged = tx.ops.some((op) => op.type === 'block.update' && op.patch.blockType !== undefined);
    if (structural || typeChanged) {
      this.view.render(this.doc);
      return;
    }
    for (const id of tx.blockIds) {
      const block = this.doc.blocks[id];
      if (block && block !== prevDoc.blocks[id]) this.view.updateBlock(block);
    }
  }
}

// ─────────────────────────────────────────────────────────────

function createEmptyDoc(newId: () => string): EditorDoc {
  const id = newId();
  return {
    rootIds: [id],
    blocks: { [id]: { id, parentId: null, type: 'paragraph', props: {}, content: [], children: [], version: 1 } },
  };
}

/** 保證傳進來的 doc 的 content 都是 normalize 過的（canonical form）。 */
function normalizeDoc(doc: EditorDoc): EditorDoc {
  const blocks: Record<string, Block> = {};
  for (const [id, block] of Object.entries(doc.blocks)) {
    blocks[id] = { ...block, content: normalize(block.content) };
  }
  return { rootIds: doc.rootIds.slice(), blocks };
}

/**
 * 遠端 ops 套用後，把本地游標推回正確位置。
 * 目前只處理「同一個 block 內的文字變更」，這是協作時 99% 的情況；
 * M6 導入 OT 後會改成正式的 transform。
 */
export function rebaseSelection(before: EditorDoc, after: EditorDoc, sel: EditorSelection): EditorSelection {
  if (sel.type !== 'text') return sel;
  const blockId = sel.focus.blockId;
  const oldBlock = before.blocks[blockId];
  const newBlock = after.blocks[blockId];
  if (!newBlock) return NO_SELECTION; // block 被別人刪掉了
  if (!oldBlock || oldBlock.content === newBlock.content) return sel;
  const diff = diffRichText(oldBlock.content, newBlock.content);
  if (!diff) return sel;
  const delta = rtLength(diff.insert) - (diff.to - diff.from);
  const shift = (offset: number): number => {
    if (offset <= diff.from) return offset;
    if (offset >= diff.to) return Math.max(0, offset + delta);
    return diff.from + rtLength(diff.insert);
  };
  return {
    type: 'text',
    anchor: { blockId: sel.anchor.blockId, offset: shift(sel.anchor.offset) },
    focus: { blockId, offset: shift(sel.focus.offset) },
  };
}

export { flattenDoc, invertOps, createTransaction };
export type { Transaction, TransactionSource, BuildResult };
