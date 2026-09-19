/**
 * @kennote/editor-core —— 零 runtime 依賴、框架無關的 vanilla TypeScript block 編輯器引擎。
 *
 * 公開 API 入口。宿主（React / Vue / 任何東西）只需要 import 這個檔案。
 */

// ── 資料模型 ───────────────────────────────────────────────
export type {
  Block,
  BlockType,
  DocFragment,
  EditorDoc,
  InlineAtom,
  InlineNode,
  InlineSpan,
  Mark,
  MarkType,
  RichText,
} from './model/types.js';
export { emptyDoc, isAtom, isSpan } from './model/types.js';
export {
  ancestorIds,
  blockRange,
  childrenOf,
  cloneDoc,
  createBlock,
  createId,
  descendantIds,
  flattenDoc,
  getBlock,
  indexOf,
  isDescendant,
  nextBlockId,
  nextSiblingId,
  prevBlockId,
  prevSiblingId,
} from './model/document.js';

// ── text：8 個核心純函式 + grapheme + offset ───────────────
export {
  applyMarkToRange,
  clearMarks,
  defaultAtomText,
  deleteRange,
  fromPlainText,
  inheritMarksAt,
  insertNodes,
  insertText,
  length,
  marksAt,
  nodeLength,
  nodeSignature,
  normalize,
  richTextEquals,
  slice,
  toOffsetText,
  toPlainText,
  toggleMark,
} from './text/richtext.js';
export {
  addMark,
  canonicalMark,
  findMark,
  hasMark,
  hasMarkType,
  intersectMarks,
  markKey,
  markSlot,
  marksEqual,
  marksSignature,
  normalizeMarks,
  removeMark,
  sameMark,
} from './text/marks.js';
export {
  graphemeBoundaries,
  nextGrapheme,
  nextWordBoundary,
  prevGrapheme,
  prevWordBoundary,
  splitGraphemes,
} from './text/grapheme.js';
export { codePointAt, codePointLength, codePointToUtf16, sliceByCodePoint, utf16ToCodePoint } from './text/offset.js';
export { diffRichText, diffText, plainTextEquals } from './text/diff.js';
export type { RichTextDiff, TextChange } from './text/diff.js';

// ── transaction ────────────────────────────────────────────
export type { Operation, OperationType, TextDelta, TextDeltaOp } from './transaction/operation.js';
export { isStructuralOp, opBlockId } from './transaction/operation.js';
export { applyOps, applyTextDelta, OperationError } from './transaction/apply.js';
export { invertOne, invertOps } from './transaction/invert.js';
export { createTransaction } from './transaction/transaction.js';
export type { Transaction, TransactionInput, TransactionKind, TransactionSource } from './transaction/transaction.js';
export {
  defaultBuilderContext,
  deleteBlocksOps,
  deleteRangeOps,
  exitBlockOps,
  extendBlockSelection,
  indentOps,
  insertBlockAfterOps,
  insertFragmentOps,
  insertInlineOps,
  insertTextOps,
  mergeBackwardOps,
  mergeForwardOps,
  moveBlockOps,
  outdentOps,
  setBlockTypeOps,
  splitBlockOps,
  toggleMarkOps,
  Tx,
} from './transaction/builders.js';
export type { BuilderContext, BuildResult } from './transaction/builders.js';

// ── selection ──────────────────────────────────────────────
export type { EditorSelection, ModelSelection, TextPoint } from './selection/types.js';
export {
  blockSelection,
  focusBlockIdOf,
  isCollapsed,
  isWithinOneBlock,
  NO_SELECTION,
  orderedRange,
  selectionBlockIds,
  selectionEquals,
  textSelection,
} from './selection/types.js';
export {
  ATOM_ATTR,
  BLOCK_CONTENT_ATTR,
  BLOCK_ID_ATTR,
  closestBlock,
  closestContentEl,
  domToModel,
  domToRichText,
  getContentEl,
  IDX_ATTR,
  IGNORE_ATTR,
  isAtomEl,
  MARKS_ATTR,
  measureNode,
  modelToDom,
} from './selection/dom-mapper.js';
export type { DomPosition } from './selection/dom-mapper.js';
export {
  caretPositionFromPoint,
  estimateLineHeight,
  getSelectionRect,
  isOnFirstVisualLine,
  isOnLastVisualLine,
  rectOfRange,
} from './selection/caret.js';
export { SelectionManager } from './selection/manager.js';
export type { BlockElementProvider, SelectionManagerOptions } from './selection/manager.js';
export { BlockSelectionController, findBlockIdFromPoint, paintBlockSelection, SELECTED_ATTR } from './selection/block-selection.js';

// ── view ───────────────────────────────────────────────────
export { renderInline } from './view/dom-view.js';
export type { RenderInlineOptions } from './view/dom-view.js';
export { BlockView } from './view/block-view.js';
export { DomView } from './view/view.js';
export type { EditorView, ViewOptions } from './view/view.js';
export { el, escapeAttr, escapeHtml, safeUrl } from './view/dom-utils.js';

// ── plugins / block registry ───────────────────────────────
export { BlockRegistry, createDefaultRegistry, placeholderDefinition } from './plugins/block-registry.js';
export type { BlockDefinition, BlockGroup, MarkdownShortcut, RenderCtx } from './plugins/block-registry.js';
export type { EditorPlugin, PluginContext } from './plugins/types.js';

// ── history ────────────────────────────────────────────────
export { HistoryStack } from './history/stack.js';
export type { HistoryOptions } from './history/stack.js';
export { canCoalesce, COALESCE_WINDOW_MS, isAdjacent } from './history/coalesce.js';
export type { HistoryEntry } from './history/types.js';

// ── clipboard ──────────────────────────────────────────────
export {
  extractFragment,
  fragmentFromRichText,
  fragmentToHTML,
  fragmentToMarkdown,
  fragmentToPlainText,
  inlineToHTML,
  inlineToMarkdown,
  inlineToPlainText,
  KENNOTE_MIME,
  reassignIds,
  toClipboardPayload,
} from './clipboard/serialize.js';
export { parseHTMLToBlocks } from './clipboard/parse-html.js';
export type { ParseHTMLOptions } from './clipboard/parse-html.js';
export {
  looksLikeMarkdown,
  parseInlineMarkdown,
  parseMarkdownToBlocks,
  parsePlainTextToBlocks,
} from './clipboard/parse-markdown.js';
export { fragmentFromClipboard, getSelectedFragment, handleCopy, handleCut, handlePaste } from './clipboard/clipboard.js';

// ── input ──────────────────────────────────────────────────
export { handleBeforeInput, HANDLED_INPUT_TYPES } from './input/before-input.js';
export { handleKeyDown } from './input/keymap.js';
export { CompositionController, COMPOSITION_COOLDOWN_MS } from './input/composition.js';
export { MutationGuard } from './input/mutation-guard.js';
export { InputController } from './input/controller.js';
export { MenuTriggerController } from './input/triggers.js';
export { applyBlockInputRule, applyInlineInputRule, INLINE_RULES, runInputRules } from './input/input-rules.js';
export * as commands from './input/commands.js';

// ── OT（M6 才啟用，型別先定） ──────────────────────────────
export { deltaLength, normalizeDelta } from './ot/types.js';

// ── Editor 門面 ────────────────────────────────────────────
export { Editor, rebaseSelection } from './core.js';
export type { CreateEditorOptions, EditorEventMap, MenuTriggerPayload } from './core.js';

import { Editor, type CreateEditorOptions } from './core.js';

/**
 * 建立一個編輯器實例。
 *
 * ```ts
 * const editor = createEditor({ container, doc });
 * const off = editor.on('localOps', (ops) => sync.submit(ops));
 * // ...
 * off();
 * editor.destroy();
 * ```
 */
export function createEditor(options: CreateEditorOptions): Editor {
  return new Editor(options);
}

export const VERSION = '0.1.0';
