/**
 * 擴充點：EditorPlugin。
 *
 * plugin 是「掛在生命週期上的一組回呼」，不是繼承。
 * 回傳 true 代表「我處理掉了」，editor 就不再走預設行為。
 */
import type { EditorDoc } from '../model/types.js';
import type { Transaction } from '../transaction/transaction.js';
import type { EditorSelection } from '../selection/types.js';

export interface PluginContext {
  getDoc(): EditorDoc;
  getSelection(): EditorSelection;
  applyTransaction(tx: Transaction): void;
}

export interface EditorPlugin {
  name: string;
  /** 編輯器掛載完成。回傳的函式會在 destroy 時呼叫。 */
  setup?(ctx: PluginContext): (() => void) | void;
  /** 在 transaction 套用前攔截／改寫。回傳 null 代表取消這次變更。 */
  filterTransaction?(tx: Transaction, ctx: PluginContext): Transaction | null;
  /** transaction 套用後。 */
  onTransaction?(tx: Transaction, ctx: PluginContext): void;
  /** 鍵盤事件。回傳 true 代表已處理。 */
  onKeyDown?(event: KeyboardEvent, ctx: PluginContext): boolean;
  /** beforeinput。回傳 true 代表已處理。 */
  onBeforeInput?(event: InputEvent, ctx: PluginContext): boolean;
  onSelectionChange?(sel: EditorSelection, ctx: PluginContext): void;
}
