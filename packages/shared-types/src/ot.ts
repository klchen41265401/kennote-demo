/**
 * 自建簡化版 OT 的**線路型別**（04 §6.6.1、§8 M6 第 1–5 項）。
 *
 * 演算法（transform / compose / apply / invert）住在 `@kennote/editor-core` 的 `src/ot/`，
 * 前後端共用同一份實作 —— 伺服器與客戶端算出不同的 transform 結果就永遠不會收斂，
 * 所以**絕對不可以**兩邊各寫一份。這個檔案只負責：
 *   1. 前後端共用的型別（與 editor-core 的 `OtDelta` 結構完全相同）
 *   2. `text.delta` operation 的建構 / 判別 helper
 *   3. `blocks.rev` 的讀取 helper
 *
 * 為什麼不直接改 `operation.ts` 的 `TextDelta`：
 * 那個型別從 M1 就定死並被 `Operation` 引用。`OtDelta` **結構上可以指派給 `TextDelta`**
 * （只是多了幾個 optional 欄位），所以不需要改動既有契約，
 * 舊的 LWW 客戶端也不會因為型別變動而壞掉。
 */
import type { InlineAtom, Mark, RichText } from './richtext.js';
import type { Block } from './block.js';
import type { Operation } from './operation.js';

/** atom 在 delta 的 insert 字串裡的佔位字元（U+FFFC）。atom 佔 1 個 offset 單位。 */
export const ATOM_PLACEHOLDER = '￼';

/** 「對既有文字套用格式」的最小描述：remove 先套、add 後套。 */
export interface MarkPatch {
  add?: Mark[];
  remove?: Mark[];
}

export type OtRetainOp = { retain: number; marks?: MarkPatch };
export type OtInsertOp = { insert: string; marks?: Mark[]; atom?: InlineAtom };
export type OtDeleteOp = { delete: number };

/** 三種原子操作。04 §6.6.1 的 `TextOp`。 */
export type OtTextOp = OtRetainOp | OtInsertOp | OtDeleteOp;

/**
 * 04 §6.6.1 的 `TextDelta`。
 *
 * 不變量：`retain + delete` 的總和 <= 套用前的文件長度。
 */
export interface OtDelta {
  ops: OtTextOp[];
}

export const EMPTY_OT_DELTA: OtDelta = { ops: [] };

export function isOtRetain(op: OtTextOp): op is OtRetainOp {
  return typeof (op as OtRetainOp).retain === 'number';
}

export function isOtInsert(op: OtTextOp): op is OtInsertOp {
  return typeof (op as OtInsertOp).insert === 'string';
}

export function isOtDelete(op: OtTextOp): op is OtDeleteOp {
  return typeof (op as OtDeleteOp).delete === 'number';
}

/**
 * `text.delta` operation 的完整形狀。
 *
 * - client → server：帶 `baseRev`（「我這個 delta 是基於 block 的哪一版算出來的」）
 * - server → client：`TransactionResult.ops` 裡回傳**已 transform** 的 delta，
 *   並回填 `rev`（套用之後的新版本）。其他人收到的也是這個 transform 過的版本。
 */
export interface TextDeltaOperation {
  type: 'text.delta';
  blockId: string;
  delta: OtDelta;
  baseRev: number;
  /** 伺服器回填：套用之後的新 rev */
  rev?: number;
}

/** `baseRev` 用這個值代表「我不知道 rev，請以目前的伺服器版本為準」（僅限 debug / 遷移）。 */
export const UNKNOWN_REV = -1;

export function isTextDeltaOperation(op: Operation): op is Operation & TextDeltaOperation {
  return op.type === 'text.delta';
}

/**
 * 把 `Operation` 上的 `TextDelta`（M1 定案的 wire 型別，marks 是 `unknown[]`）
 * 視為 `OtDelta`。兩者結構相同，只差在 marks 的精確度；
 * 真正的內容驗證由伺服器的 `assertValidDelta()` 負責。
 */
export function asOtDelta(delta: { ops: unknown[] }): OtDelta {
  return delta as unknown as OtDelta;
}

/** 建一個 `text.delta` operation（型別上仍然是合法的 `Operation`）。 */
export function textDeltaOperation(
  blockId: string,
  delta: OtDelta,
  baseRev: number,
  rev?: number,
): Operation {
  const op: TextDeltaOperation = { type: 'text.delta', blockId, delta, baseRev };
  if (rev !== undefined) op.rev = rev;
  return op as unknown as Operation;
}

/**
 * 讀出一個 block 的 OT rev。
 *
 * `rev` 是 M6 才加的欄位（`blocks.rev`），`Block` 介面沒有宣告它
 * （避免改動 M1 就定案的契約），所以統一從這裡讀，沒有就當 0。
 */
export function blockRevOf(block: Pick<Block, 'id'> & { rev?: unknown }): number {
  const rev = (block as { rev?: unknown }).rev;
  return typeof rev === 'number' && Number.isFinite(rev) ? rev : 0;
}

/**
 * `text.delta` 是不是只有格式/文字變更（永遠是 true，留著讓呼叫端語義清楚）。
 * 真正的用途：把一批 ops 拆成「delta 通道」與「tx 通道」兩群，且**保持原本的先後順序**。
 */
export function splitDeltaOps(ops: Operation[]): Array<
  { kind: 'delta'; ops: Array<Operation & TextDeltaOperation> } | { kind: 'tx'; ops: Operation[] }
> {
  const out: Array<
    { kind: 'delta'; ops: Array<Operation & TextDeltaOperation> } | { kind: 'tx'; ops: Operation[] }
  > = [];
  for (const op of ops) {
    const kind = isTextDeltaOperation(op) ? 'delta' : 'tx';
    const last = out[out.length - 1];
    if (last && last.kind === kind) {
      (last.ops as Operation[]).push(op);
      continue;
    }
    if (kind === 'delta') out.push({ kind, ops: [op as Operation & TextDeltaOperation] });
    else out.push({ kind, ops: [op] });
  }
  return out;
}

/** RichText 的純文字長度（code point，atom 佔 1）。伺服器做 delta 合法性檢查用。 */
export function otContentLength(content: RichText): number {
  let n = 0;
  for (const node of content) {
    if (typeof (node as { text?: unknown }).text === 'string') {
      n += [...(node as { text: string }).text].length;
    } else {
      n += 1;
    }
  }
  return n;
}
