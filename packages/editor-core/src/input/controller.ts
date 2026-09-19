/**
 * InputController：把所有 DOM 事件接到 editor 上。
 *
 * 用原生 addEventListener 綁 beforeinput / composition*，繞過任何框架的合成事件層
 * （04 §3.5 第四條紀律）。
 */
import type { DocFragment } from '../model/types.js';
import type { Editor } from '../core.js';
import { CompositionController } from './composition.js';
import { handleBeforeInput } from './before-input.js';
import { handleKeyDown } from './keymap.js';
import { MutationGuard } from './mutation-guard.js';
import { MenuTriggerController } from './triggers.js';
import { runInputRules } from './input-rules.js';
import { getSelectedFragment, handleCopy, handleCut, handlePaste, insertFragment } from '../clipboard/clipboard.js';
import { blockSelection, orderedRange } from '../selection/types.js';
import { slice, toOffsetText } from '../text/richtext.js';
import { BLOCK_ID_ATTR, closestBlock } from '../selection/dom-mapper.js';

export class InputController {
  private readonly editor: Editor;
  private readonly composition: CompositionController;
  private readonly guard: MutationGuard;
  private readonly triggers: MenuTriggerController;
  private root: HTMLElement | null = null;
  private offTransaction: (() => void) | null = null;

  // keymap host 狀態
  goalX: number | null = null;
  selectAllCount = 0;

  /** 剛套用 input rule：下一個 Backspace 要還原轉換（02 §4.1.5 規則 2）。 */
  private inputRuleJustApplied = false;

  constructor(editor: Editor) {
    this.editor = editor;
    this.composition = new CompositionController(editor);
    this.guard = new MutationGuard(editor, {
      get isComposing() {
        return editor.isComposing;
      },
      get inCooldown() {
        return false;
      },
    });
    this.triggers = new MenuTriggerController(editor);
  }

  get isComposing(): boolean {
    return this.composition.isComposing;
  }

  get mutationTriggerCount(): number {
    return this.guard.triggerCount;
  }

  /** 測試用：直接完成 composition（跳過 requestAnimationFrame）。 */
  finishComposition(): void {
    this.composition.finish();
  }

  attach(): void {
    const root = this.editor.view.root;
    this.root = root;
    root.addEventListener('beforeinput', this.onBeforeInput as EventListener);
    root.addEventListener('keydown', this.onKeyDown as EventListener);
    root.addEventListener('copy', this.onCopy as EventListener);
    root.addEventListener('cut', this.onCut as EventListener);
    root.addEventListener('paste', this.onPaste as EventListener);
    root.addEventListener('pointerdown', this.onPointerDown as EventListener);
    root.addEventListener('blur', this.onBlur as EventListener, true);
    this.composition.attach(root);
    this.guard.attach(root);
    // 我們自己造成的 DOM 變更不算「瀏覽器亂改」，要在同一個同步任務內丟掉
    this.offTransaction = this.editor.on('transaction', () => {
      this.guard.discardOwnMutations();
      this.triggers.update();
    });
  }

  detach(): void {
    const root = this.root;
    if (root) {
      root.removeEventListener('beforeinput', this.onBeforeInput as EventListener);
      root.removeEventListener('keydown', this.onKeyDown as EventListener);
      root.removeEventListener('copy', this.onCopy as EventListener);
      root.removeEventListener('cut', this.onCut as EventListener);
      root.removeEventListener('paste', this.onPaste as EventListener);
      root.removeEventListener('pointerdown', this.onPointerDown as EventListener);
      root.removeEventListener('blur', this.onBlur as EventListener, true);
    }
    this.composition.detach();
    this.guard.detach();
    this.offTransaction?.();
    this.offTransaction = null;
    this.root = null;
  }

  getSelectedFragment(): DocFragment | null {
    return getSelectedFragment(this.editor);
  }

  insertFragment(fragment: DocFragment): boolean {
    return insertFragment(this.editor, fragment);
  }

  // ── 事件處理 ─────────────────────────────────────────────

  private onBeforeInput = (event: InputEvent): void => {
    for (const plugin of this.pluginList()) {
      if (plugin.onBeforeInput?.(event, this.pluginCtx())) return;
    }
    // 只有「緊接著的 Backspace」能還原剛剛的 markdown 轉換；其他輸入一律清掉旗標
    if (event.inputType !== 'deleteContentBackward') this.inputRuleJustApplied = false;
    handleBeforeInput(this.editor, this, event);
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    for (const plugin of this.pluginList()) {
      if (plugin.onKeyDown?.(event, this.pluginCtx())) {
        event.preventDefault();
        return;
      }
    }
    // slash menu 開啟時，方向鍵與 Enter 由宿主接手
    if (this.triggers.isOpen && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(event.key)) return;
    if (this.triggers.isOpen && event.key === 'Escape') {
      this.triggers.close();
      event.preventDefault();
      return;
    }
    if (handleKeyDown(this.editor, this, event)) event.preventDefault();
  };

  private onCopy = (event: ClipboardEvent): void => {
    handleCopy(this.editor, event);
  };

  private onCut = (event: ClipboardEvent): void => {
    handleCut(this.editor, event);
  };

  private onPaste = (event: ClipboardEvent): void => {
    this.editor.history.breakpoint();
    handlePaste(this.editor, event);
  };

  private onPointerDown = (event: PointerEvent): void => {
    // 點擊移動游標 → 強制 undo 斷點（02 §4.0.5）
    this.editor.history.breakpoint();
    this.goalX = null;
    this.triggers.close();

    const target = event.target;
    if (!(target instanceof Element)) return;

    // todo 的勾選框
    const checkbox = target.closest('[data-todo-checkbox]');
    if (checkbox) {
      const blockEl = closestBlock(checkbox);
      const id = blockEl?.getAttribute(BLOCK_ID_ATTR);
      if (id) {
        event.preventDefault();
        const block = this.editor.getBlock(id);
        if (block) this.editor.setBlockType(id, 'todo', { ...block.props, checked: !block.props.checked });
      }
      return;
    }

    // toggle 的箭頭
    const arrow = target.closest('[data-toggle-arrow]');
    if (arrow) {
      const blockEl = closestBlock(arrow);
      const id = blockEl?.getAttribute(BLOCK_ID_ATTR);
      if (id) {
        event.preventDefault();
        const block = this.editor.getBlock(id);
        if (block) this.editor.setBlockType(id, 'toggle', { ...block.props, collapsed: !block.props.collapsed });
      }
      return;
    }

    // 點在不可編輯的 block 上 → 進入 block selection
    const blockEl = closestBlock(target);
    const id = blockEl?.getAttribute(BLOCK_ID_ATTR);
    if (id) {
      const block = this.editor.getBlock(id);
      if (block && !this.editor.registry.get(block.type).hasInlineContent) {
        event.preventDefault();
        this.editor.setSelection(blockSelection([id], id, id));
      }
    }
  };

  private onBlur = (): void => {
    this.editor.history.breakpoint();
    this.triggers.close();
  };

  // ── BeforeInputHost / KeymapHost 實作 ────────────────────

  afterInputRuleUndo(): boolean {
    if (!this.inputRuleJustApplied) return false;
    this.inputRuleJustApplied = false;
    return this.editor.undo();
  }

  runInputRules(blockId: string): void {
    const sel = this.editor.getSelection();
    const range = orderedRange(sel);
    const caret = range ? range.end : 0;
    const inserted = caret > 0 ? lastCharOf(this.editor, blockId, caret) : '';
    this.triggers.onTextInserted(blockId, caret, inserted);
    if (this.triggers.isOpen) return; // slash menu 開著時不跑 markdown 轉換
    const applied = runInputRules(this.editor, blockId);
    this.inputRuleJustApplied = applied;
  }

  enterBlockMode(blockId: string): void {
    this.editor.blockSelection.enterBlockMode(blockId);
  }

  exitBlockMode(): void {
    this.editor.blockSelection.exitBlockMode();
  }

  private pluginList() {
    return (this.editor as unknown as { plugins: import('../plugins/types.js').EditorPlugin[] }).plugins ?? [];
  }

  private pluginCtx() {
    return {
      getDoc: () => this.editor.getDoc(),
      getSelection: () => this.editor.getSelection(),
      applyTransaction: (tx: import('../transaction/transaction.js').Transaction) => {
        this.editor.applyTransaction(tx);
      },
    };
  }
}

function lastCharOf(editor: Editor, blockId: string, caret: number): string {
  const block = editor.getBlock(blockId);
  if (!block) return '';
  return toOffsetText(slice(block.content, Math.max(0, caret - 1), caret));
}
