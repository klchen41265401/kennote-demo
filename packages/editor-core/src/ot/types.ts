/**
 * 自建簡化版 OT 的資料模型（04 §6.6.1）。
 *
 * 規格把型別叫 `TextDelta` / `TextOp`；本專案在 M2-A 就已經把
 * `TextDelta`（`transaction/operation.ts`）當成 **wire 型別**定死並寫進
 * `Operation` 的 `text.delta` 分支，所以 OT 這一層改用 `OtDelta` / `OtTextOp`
 * 這組名字，避免同一個 package 匯出兩個同名型別。
 *
 * **結構上 `OtDelta` 可直接指派給 `TextDelta`**（只是多了幾個 optional 欄位），
 * 因此不需要任何轉換就能塞進 `text.delta` operation 送出去。
 *
 * 設計要點：
 *  1. 三種原子操作：retain / insert / delete —— 最小可行、最好證明正確性。
 *  2. 長度單位與 RichText 完全一致：**code point，atom 佔 1**。
 *  3. atom（mention / date / pageLink / equation）用
 *     `{ insert: '￼', atom }` 表示 —— insert 仍然是字串（長度 1），
 *     所以長度計算、切片、transform 全部不必特別處理 atom；
 *     只有 `apply()` 在產生節點時才看 `atom` 欄位。
 *     舊的 LWW 客戶端拿到這種 delta 會插入一個 U+FFFC 佔位字元（可接受的降級）。
 *  4. retain 可以帶 `marks`（MarkPatch），這是「只改格式不改文字」的表示法，
 *     否則套個粗體就得整段 delete+insert，transform 的結果會很難看。
 *
 * 不變量：一個 delta 的 `retain + delete` 總和 <= 套用前的文件長度。
 * 這個不變量讓 transform / compose 的正確性可以被驗證（見 test/ot/）。
 */
import type { InlineAtom, Mark, RichText } from '../model/types.js';
import type { Operation, TextDelta, TextDeltaOp } from '../transaction/operation.js';

export type { Operation, TextDelta, TextDeltaOp };

/** atom 在 delta 的 insert 字串裡的佔位字元（U+FFFC OBJECT REPLACEMENT CHARACTER）。 */
export const ATOM_PLACEHOLDER = '￼';

/**
 * 「對既有文字套用格式」的最小描述。
 * `remove` 先套、`add` 後套；同一個 slot（b/i/link/color/comment:id）只會有一個 mark。
 */
export interface MarkPatch {
  add?: Mark[];
  remove?: Mark[];
}

export type OtRetainOp = { retain: number; marks?: MarkPatch };
export type OtInsertOp = { insert: string; marks?: Mark[]; atom?: InlineAtom };
export type OtDeleteOp = { delete: number };

export type OtTextOp = OtRetainOp | OtInsertOp | OtDeleteOp;

/** 規格 §6.6.1 的 `TextDelta`。 */
export interface OtDelta {
  ops: OtTextOp[];
}

export const EMPTY_DELTA: OtDelta = { ops: [] };

export function isRetain(op: OtTextOp): op is OtRetainOp {
  return typeof (op as OtRetainOp).retain === 'number';
}

export function isInsert(op: OtTextOp): op is OtInsertOp {
  return typeof (op as OtInsertOp).insert === 'string';
}

export function isDelete(op: OtTextOp): op is OtDeleteOp {
  return typeof (op as OtDeleteOp).delete === 'number';
}

/**
 * `text.delta` operation 的完整形狀。
 *
 * `rev` 是**伺服器回填**的欄位：client 送出時只有 `baseRev`，
 * 伺服器套用之後在 `TransactionResult.ops` 裡回傳 transform 過的 delta 與新的 rev。
 * （`Operation` 的 union member 沒有 `rev`，多帶 optional 欄位仍然可以指派。）
 */
export interface TextDeltaOperation {
  type: 'text.delta';
  blockId: string;
  delta: OtDelta;
  baseRev: number;
  rev?: number;
}

export function isTextDeltaOp(op: Operation): op is Operation & TextDeltaOperation {
  return op.type === 'text.delta';
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

/** 本地端的文件狀態（transform 的輸入之一）。 */
export type OtDocument = RichText;
