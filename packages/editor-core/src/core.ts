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
import { HistoryStack, type HistoryDelta, type HistoryOptions } from './history/stack.js';
import type { HistoryEntry } from './history/types.js';
import {
  apply as applyOtDelta,
  deltaFromDiff,
  invert as invertOtDelta,
  isNoop,
  textDeltaOperation,
  transformCursor,
  type OtDelta,
} from './ot/index.js';
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
  /**
   * M6 自建 OT（04 §6.6）。預設關閉 → 行為與 M5 完全相同（block 粒度 LWW）。
   *
   * 開啟之後：
   *   - `localOps` 事件中「同一個 block 內、只改 content」的 `block.update`
   *     會被換成 `text.delta`（宿主把它交給 OT 三狀態機送出）
   *   - 結構變更（insert / move / delete / 換型別 / 改 props）仍然走原本的 tx 通道
   *   - undo / redo 改用可 transform 的 delta 表示（協作 undo）
   */
  ot?: OtHostOptions;
}

export interface OtHostOptions {
  enabled: boolean;
  /** 這個 block 目前對齊到的伺服器 rev（由宿主的 OT client 維護）。 */
  getBaseRev?(blockId: string): number;
}

/** IME 組字期間排隊的遠端變更（保持 ops 與 delta 的相對順序）。 */
type RemoteQueueItem =
  | { kind: 'ops'; ops: Operation[] }
  | { kind: 'delta'; blockId: string; delta: OtDelta };

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
  private remoteQueue: RemoteQueueItem[] = [];
  private destroyed = false;
  private readonly ot: OtHostOptions;

  constructor(options: CreateEditorOptions) {
    this.container = options.container;
    this.registry = options.blockRegistry ?? createDefaultRegistry();
    this.newId = options.newId ?? createId;
    this.now = options.now ?? (() => Date.now());
    this.doc = normalizeDoc(options.doc ?? createEmptyDoc(this.newId));
    this.plugins = options.plugins ?? [];
    this.ot = options.ot ?? { enabled: false };

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

    // OT 模式：把「只改 content」的 block.update 壓縮成 delta，
    // 同時給 history（協作 undo 要能對後續遠端 delta 做 transform）與 localOps（送出）使用
    const deltas = this.ot.enabled ? contentDeltas(prevDoc, this.doc, current.ops) : null;

    if (current.source === 'user' || current.source === 'ime' || current.source === 'paste') {
      this.history.record(current, deltas ?? undefined);
    }

    if (current.selectionAfter.type !== 'none') this.setSelection(current.selectionAfter);

    this.emit('transaction', current, this.doc);
    if (current.source !== 'remote') {
      // ⭐ OT 模式：**任何**覆寫既有 block content 的 op 都要換成 text.delta（ADR 0006 §2.9）。
      // 不是只有「content-only」的那種 —— markdown 捷徑 / setBlockType / Enter 分割
      // 都是「換型別或結構 + 整段覆寫 content」，它們若帶著 content 走 tx 通道，
      // 就會和 OT 通道裡還沒送出的 delta 撞在一起（BUG-4：`> quote` 重整後變 `quote>`）。
      this.emit('localOps', this.ot.enabled ? this.toWireOps(current.ops, prevDoc) : current.ops, current);
    }
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
      this.remoteQueue.push({ kind: 'ops', ops });
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

  /**
   * 套用一個遠端 delta（OT 通道）。
   *
   * 與 `applyRemote` 的差別：
   *   1. 用 `transformCursor` 精準推游標（不是 diff 猜），因此不會在別人於游標前打字時跳位
   *   2. 通知 history 對 undo/redo stack 裡的 delta 做 transform（協作 undo）
   *
   * 傳進來的 delta 必須已經被 OT 三狀態機 transform 過（宿主端的 `OtClient.applyRemote`）。
   */
  applyRemoteDelta(blockId: string, delta: OtDelta): boolean {
    if (this.destroyed) return false;
    if (isNoop(delta)) return false;
    if (this.isComposing) {
      this.remoteQueue.push({ kind: 'delta', blockId, delta });
      return false;
    }
    const block = this.doc.blocks[blockId];
    if (!block) return false;

    const selectionBefore = this.selection.value;
    const content = applyOtDelta(block.content, delta);
    const ops: Operation[] = [{ type: 'block.update', blockId, patch: { content } }];
    const tx = createTransaction(this.doc, {
      ops,
      selectionBefore,
      selectionAfter: selectionBefore,
      source: 'remote',
      timestamp: this.now(),
    });
    const applied = this.applyTransaction({ ...tx, selectionAfter: NO_SELECTION });
    if (!applied) return false;

    this.setSelection(rebaseSelectionByDelta(selectionBefore, blockId, delta));
    this.history.onRemoteDelta(blockId, delta);
    return true;
  }

  /** 解除 IME 凍結後，把排隊的遠端變更沖出去（維持原本的先後順序）。 */
  flushRemoteQueue(): void {
    if (this.remoteQueue.length === 0) return;
    const queued = this.remoteQueue;
    this.remoteQueue = [];
    for (const item of queued) {
      if (item.kind === 'ops') this.applyRemote(item.ops);
      else this.applyRemoteDelta(item.blockId, item.delta);
    }
  }

  get pendingRemoteOps(): number {
    let n = 0;
    for (const item of this.remoteQueue) n += item.kind === 'ops' ? item.ops.length : 1;
    return n;
  }

  // ── 常用命令 ─────────────────────────────────────────────

  undo(): boolean {
    return this.applyHistory('inverse');
  }

  redo(): boolean {
    return this.applyHistory('forward');
  }

  /**
   * undo / redo 的**唯一**路徑（BUG-18）。
   *
   * 兩件事一起保證：
   *   1. 先 `peek` 再套用，成功了才 `commit` 把紀錄搬到另一邊。
   *      舊寫法是「先 pop 再套用」，套用失敗時紀錄已經被搬走 ——
   *      redo 失敗一次，redo stack 就永遠空了，內容再也回不來。
   *   2. delta 路徑失敗（block 被刪掉 / transform 後不合法）時退回保守的整段 ops；
   *      連保守路徑都套不上就回 `false`，**紀錄留在原地**。
   */
  private applyHistory(direction: 'forward' | 'inverse'): boolean {
    const entry = direction === 'inverse' ? this.history.peekUndo() : this.history.peekRedo();
    if (!entry) return false;

    const fallback = direction === 'inverse' ? entry.inverseOps : entry.ops;
    const primary = this.historyOps(entry, direction);
    const candidates = primary ? [primary, fallback] : [fallback];

    for (const ops of candidates) {
      if (ops.length === 0) continue;
      let tx: Transaction;
      try {
        tx = createTransaction(this.doc, {
          ops,
          selectionBefore: direction === 'inverse' ? entry.selectionAfter : entry.selectionBefore,
          selectionAfter: direction === 'inverse' ? entry.selectionBefore : entry.selectionAfter,
          source: 'history',
          kind: entry.kind,
          timestamp: this.now(),
        });
      } catch (error) {
        if (error instanceof OperationError) continue; // 這一組不合法 → 試下一組
        throw error;
      }
      if (!this.applyTransaction(tx)) continue;
      if (direction === 'inverse') this.history.commitUndo();
      else this.history.commitRedo();
      return true;
    }
    return false; // 兩組都套不上 → 紀錄保留在原本的 stack 上
  }

  /**
   * 協作 undo（04 §8 M6-5）＋ 跨 block 的結構 op（BUG-18）。
   *
   * OT 模式下，undo/redo 不再套用「當時記下的整段舊內容」（那會蓋掉別人後來打的字），
   * 而是把已經對後續遠端 delta transform 過的 delta，套到**目前**的內容上。
   *
   * ⭐ 關鍵是**逐 op 分流**，不是「用 delta 生出來的那幾個 op 整批取代 entry.ops」：
   *
   *   - 只改 content 的 `block.update`  → 換成「現在的內容 + transform 過的 delta」
   *   - 結構 op（`block.insert` / `block.delete` / `block.move` /
   *     帶 `blockType` / `props` 的 `block.update`）→ **原樣保留**、順序不變
   *
   * 舊寫法只從 delta 生 `block.update`，一筆同時含 `block.insert` 的 entry
   * （Enter 把段落拆兩半）會把 `block.insert` 整個丟掉 ——
   * redo「拆段落」於是變成「把前一段的字砍掉、但不建新 block」。
   *
   * 同一個 block 在一筆 entry 裡被連續改好幾次（coalesce 過的打字）時，
   * 合併後的 delta 一次到位，所以只保留**最後一個**內容 op 的位置，
   * 前面那幾個丟掉；這樣它與結構 op 的相對順序仍然正確。
   */
  private historyOps(entry: HistoryEntry, direction: 'forward' | 'inverse'): Operation[] | null {
    if (!this.ot.enabled) return null;
    const deltas = entry.deltas;
    if (!deltas || deltas.length === 0) return null;
    const source = direction === 'forward' ? entry.ops : entry.inverseOps;
    if (source.length === 0) return null;

    const byBlock = new Map<string, OtDelta>();
    for (const item of deltas) byBlock.set(item.blockId, direction === 'forward' ? item.forward : item.inverse);

    // 每個 block 只在「最後一個內容 op」的位置套 delta（前面的已經被 compose 進去了）
    const lastContentIndex = new Map<string, number>();
    source.forEach((op, index) => {
      if (isContentOnlyUpdate(op) && byBlock.has(op.blockId)) lastContentIndex.set(op.blockId, index);
    });

    // 沒有結構 op（連打的 entry，最常見）→ 不必模擬中間狀態，省掉每個 op 一次 cloneDoc
    const structural = source.some((op) => !isContentOnlyUpdate(op));
    let doc = this.doc;
    const out: Operation[] = [];
    for (let index = 0; index < source.length; index++) {
      const op = source[index]!;
      let next: Operation = op;
      if (isContentOnlyUpdate(op) && byBlock.has(op.blockId)) {
        if (lastContentIndex.get(op.blockId) !== index) continue; // 合併進後面那一個
        const delta = byBlock.get(op.blockId)!;
        if (isNoop(delta)) continue;
        const block = doc.blocks[op.blockId];
        if (!block) return null; // block 已被刪掉 → 退回保守路徑
        next = {
          type: 'block.update',
          blockId: op.blockId,
          patch: { content: applyOtDelta(block.content, delta) },
        };
      }
      // 逐步推進：後面的 delta 必須以「前面幾個 op 套完」的內容為基準
      if (structural) {
        try {
          doc = applyOps(doc, [next]);
        } catch (error) {
          if (error instanceof OperationError) return null;
          throw error;
        }
      }
      out.push(next);
    }
    return out.length > 0 ? out : null;
  }

  /**
   * 送往同步層的形狀（ADR 0006 §2.9）：**任何**覆寫既有 block content 的
   * `block.update` 都被拆成 `block.update{blockType, props}`（tx 通道，LWW）
   * + `text.delta`（OT 通道，同一條 rev 線）。與伺服器廣播時的拆法完全對稱。
   */
  private toWireOps(ops: Operation[], prevDoc: EditorDoc): Operation[] {
    const running = new Map<string, RichText>();
    const out: Operation[] = [];
    let changed = false;
    for (const op of ops) {
      if (op.type === 'block.insert') {
        // 同一批裡「先 insert 再 update content」時，delta 的基準是剛插入的內容
        running.set(op.blockId, normalize(op.content ?? []));
        out.push(op);
        continue;
      }
      if (op.type !== 'block.update' || op.patch.content === undefined) {
        out.push(op);
        continue;
      }
      const before = running.get(op.blockId) ?? prevDoc.blocks[op.blockId]?.content;
      if (before === undefined) {
        // 這個 block 不在我們手上（同批剛被刪 / 資料不一致）→ 原樣送，交給 LWW
        out.push(op);
        continue;
      }
      const after = normalize(op.patch.content);
      running.set(op.blockId, after);
      changed = true;

      // 型別 / props 仍然是 LWW 的 block.update；content 交給 OT 的 rev 線。
      // 這與伺服器廣播時的拆法完全對稱（ADR 0006 §2.6 的 `splitDeltaOps`）。
      const rest: Extract<Operation, { type: 'block.update' }>['patch'] = {};
      if (op.patch.blockType !== undefined) rest.blockType = op.patch.blockType;
      if (op.patch.props !== undefined) rest.props = op.patch.props;
      if (Object.keys(rest).length > 0) {
        out.push({
          type: 'block.update',
          blockId: op.blockId,
          patch: rest,
          ...(op.baseVersion !== undefined ? { baseVersion: op.baseVersion } : {}),
        });
      }
      const forward = deltaFromDiff(normalize(before), after);
      if (isNoop(forward)) continue;
      out.push(textDeltaOperation(op.blockId, forward, this.ot.getBaseRev?.(op.blockId) ?? 0));
    }
    return changed ? out : ops;
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

/** 只改 content、不動型別與 props 的 block.update —— OT 通道要接手的就是這種 op。 */
function isContentOnlyUpdate(
  op: Operation,
): op is Extract<Operation, { type: 'block.update' }> {
  return (
    op.type === 'block.update' &&
    op.patch.content !== undefined &&
    op.patch.blockType === undefined &&
    op.patch.props === undefined
  );
}

/**
 * 從「套用前 / 套用後」的 doc 算出每個 content 變更的 forward / inverse delta。
 *
 * ⭐ BUG-18：**批次裡有結構 op 時不再整批放棄**。
 * 以前只要 ops 裡有一個 `block.insert`（Enter 拆段落）就回 `null`，
 * 那一筆 entry 於是完全沒有 delta 表示 ——
 *   1. 收到遠端 delta 時 `rebaseStack()` 無法 transform 它，整條 redo stack 被丟掉；
 *   2. undo/redo 只能套「當時的整段舊內容」，會蓋掉別人後來打的字。
 * 現在改成**逐 op 模擬**：結構 op 照樣推進中間狀態，只是自己不產生 delta；
 * 只有「只改 content 的 `block.update`」會被記成 delta。
 *
 * 同一批裡對同一個 block 連續改好幾次 content，會合併成**一個** delta
 * （base = 這一批開始前的內容，target = 這一批結束後的內容），
 * 與 `mergeEntry()` 的 coalescing 一致。
 */
function contentDeltas(
  prevDoc: EditorDoc,
  nextDoc: EditorDoc,
  ops: Operation[],
): HistoryDelta[] | null {
  if (ops.length === 0) return null;
  // 沒有結構 op（連打，最常見）→ 內容的基準就是 prevDoc，不必模擬中間狀態
  const structural = ops.some((op) => !isContentOnlyUpdate(op));
  let doc = prevDoc;
  /** blockId → { 這一批開始前的內容, 最後一次寫進去的內容 } */
  const touched = new Map<string, { base: RichText; target: RichText }>();
  for (const op of ops) {
    if (isContentOnlyUpdate(op)) {
      const block = doc.blocks[op.blockId];
      if (!block) return null; // 內容的基準不在我們手上 → 整批退回 LWW
      const before = normalize(block.content);
      const after = normalize(op.patch.content ?? []);
      const existing = touched.get(op.blockId);
      if (existing) existing.target = after;
      else touched.set(op.blockId, { base: before, target: after });
    }
    if (structural) {
      try {
        doc = applyOps(doc, [op]);
      } catch (error) {
        if (error instanceof OperationError) return null;
        throw error;
      }
    }
  }
  if (touched.size === 0) return null;

  const out: HistoryDelta[] = [];
  for (const [blockId, { base, target }] of touched) {
    // 防呆：這個 block 還在的話，算出來的目標內容必須等於實際的新內容
    const actual = nextDoc.blocks[blockId]?.content;
    if (actual && JSON.stringify(normalize(actual)) !== JSON.stringify(target)) return null;
    const forward = deltaFromDiff(base, target);
    if (isNoop(forward)) continue;
    out.push({ blockId, forward, inverse: invertOtDelta(forward, base) });
  }
  return out.length > 0 ? out : null;
}

/** 遠端 delta 套用之後，把本地游標推到正確位置（不是猜，是精確 transform）。 */
export function rebaseSelectionByDelta(
  sel: EditorSelection,
  blockId: string,
  delta: OtDelta,
): EditorSelection {
  if (sel.type !== 'text') return sel;
  if (sel.anchor.blockId !== blockId && sel.focus.blockId !== blockId) return sel;
  const shift = (point: { blockId: string; offset: number }): { blockId: string; offset: number } =>
    point.blockId === blockId
      ? { blockId, offset: transformCursor(point.offset, delta, false) }
      : point;
  return { type: 'text', anchor: shift(sel.anchor), focus: shift(sel.focus) };
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
