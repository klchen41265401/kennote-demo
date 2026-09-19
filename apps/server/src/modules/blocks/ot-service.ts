/**
 * `receiveDelta` —— 伺服器端的 OT（04 §6.6.4、§8 M6 第 4 項）。
 *
 * ```
 * 收到 delta(baseRev = V0)，目前 blocks.rev = V1（V1 >= V0）
 *  ↓ SELECT ... FOR UPDATE                    ← 序列化，同一個 block 一次只跑一個
 *  ↓ SELECT delta FROM block_deltas WHERE rev > V0 ORDER BY rev
 *  ↓ 逐一 transform(d, concurrent, priority=false)   ← 已套用的那一邊優先
 *  ↓ content = apply(content, d)；rev = V1 + 1
 *  ↓ INSERT block_deltas / UPDATE blocks
 *  ↓ 廣播 transform 過的 d（其他 client 收到的是已 transform 的版本）
 * ```
 *
 * **transform 的實作與客戶端是同一份**（`@kennote/editor-core` 的 `src/ot/`）。
 * 兩邊各寫一份 = 永遠不會收斂，這是 OT 最常見的死法。
 *
 * priority 的約定（必須與 `OtClient` 一致）：
 *   已經被伺服器套用的那一邊 priority = true，進來的那一份 priority = false。
 */
import {
  applyDelta,
  deltaFromDiff,
  isNoop,
  normalizeDelta,
  transform,
} from '@kennote/editor-core';
import type { OtDelta, RichText } from '@kennote/shared-types';
import { otContentLength } from '@kennote/shared-types';
import type { Tx } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import {
  bumpBlockRev,
  insertBlockDelta,
  listDeltasSince,
  lockBlockForDelta,
  writeBlockContentAndRev,
  type BlockOtState,
} from './ot-repo.js';

/** editor-core 與 shared-types 的 RichText 是兩份同構宣告，跨套件時統一走這裡轉型。 */
type CoreRichText = Parameters<typeof applyDelta>[0];
type CoreDelta = Parameters<typeof applyDelta>[1];

const asCore = (rt: RichText): CoreRichText => rt as unknown as CoreRichText;
const asShared = (rt: CoreRichText): RichText => rt as unknown as RichText;
const asCoreDelta = (d: OtDelta): CoreDelta => d as unknown as CoreDelta;
const asSharedDelta = (d: CoreDelta): OtDelta => d as unknown as OtDelta;

/** 一次 delta 最多能改動的長度（防呆：擋掉壞掉的 client 送出超大 delta）。 */
const MAX_DELTA_OPS = 2_000;

export interface ReceiveDeltaInput {
  blockId: string;
  pageId: string;
  delta: OtDelta;
  baseRev: number;
  actorId: string;
}

export interface ReceiveDeltaResult {
  /** 已 transform 到最新版本的 delta（要廣播給其他人的就是這一份） */
  transformed: OtDelta;
  /** 套用之後的新 rev */
  rev: number;
  /** 套用之後的完整內容（一併寫進 page_transactions，讓 LWW 客戶端與版本歷史相容） */
  content: RichText;
  /** 這次有沒有真的改到東西（全部被 transform 掉就是 no-op） */
  changed: boolean;
  /** 套用**之前**的內容。第七輪用來算 @提及的差集（新增的提及才發通知） */
  previous: RichText;
}

/** 基本形狀檢查。zod 在 validate-ops.ts 只驗到 `{ ops: object[] }`，細節在這裡把關。 */
export function assertValidDelta(delta: unknown, baseLengthLimit: number): OtDelta {
  if (!delta || typeof delta !== 'object' || !Array.isArray((delta as OtDelta).ops)) {
    throw new AppError('INVALID_OPERATION', 'text.delta 的 delta 格式不正確');
  }
  const ops = (delta as OtDelta).ops;
  if (ops.length > MAX_DELTA_OPS) {
    throw new AppError('INVALID_OPERATION', `text.delta 的 op 數量超過上限（${MAX_DELTA_OPS}）`);
  }
  let base = 0;
  for (const op of ops) {
    if (typeof op !== 'object' || op === null) {
      throw new AppError('INVALID_OPERATION', 'text.delta 含有不合法的 op');
    }
    const retain = (op as { retain?: unknown }).retain;
    const del = (op as { delete?: unknown }).delete;
    const insert = (op as { insert?: unknown }).insert;
    if (typeof retain === 'number') {
      if (!Number.isInteger(retain) || retain < 0) {
        throw new AppError('INVALID_OPERATION', 'retain 必須是非負整數');
      }
      base += retain;
    } else if (typeof del === 'number') {
      if (!Number.isInteger(del) || del < 0) {
        throw new AppError('INVALID_OPERATION', 'delete 必須是非負整數');
      }
      base += del;
    } else if (typeof insert === 'string') {
      // ok
    } else {
      throw new AppError('INVALID_OPERATION', 'op 必須是 retain / insert / delete 其中之一');
    }
  }
  // 不變量：retain + delete <= 套用前的文件長度（04 §6.6.1）
  if (base > baseLengthLimit) {
    throw new AppError('INVALID_OPERATION', 'text.delta 的長度超過 block 內容長度（baseRev 可能過舊）');
  }
  return delta as OtDelta;
}

/**
 * 04 §6.6.4 的 `receiveDelta`。**必須在已開啟的資料庫交易裡呼叫**
 * （`applyTransaction` 已經開好，且已經 `SELECT ... FOR UPDATE` 鎖住 page）。
 */
export async function receiveDelta(tx: Tx, input: ReceiveDeltaInput): Promise<ReceiveDeltaResult> {
  const block = await lockBlockForDelta(tx, input.blockId);
  if (!block || block.page_id !== input.pageId) {
    throw new AppError('BLOCK_NOT_FOUND', undefined, { blockId: input.blockId });
  }

  const currentRev = Number(block.rev ?? 0);
  const baseRev = Math.max(0, Math.min(input.baseRev, currentRev));
  const content = (block.content ?? []) as RichText;

  // baseRev 落後太多、窗口已經被清掉 → 叫 client 重抓 snapshot（不要硬套）
  const concurrent = await listDeltasSince(tx, input.blockId, baseRev);
  if (baseRev < currentRev && concurrent.length !== currentRev - baseRev) {
    throw new AppError(
      'CONFLICT',
      'text.delta 的 baseRev 太舊，transform 窗口已被清除，請重新載入頁面',
      { blockId: input.blockId, baseRev, rev: currentRev },
    );
  }

  // 用「baseRev 那一版」的長度做不變量檢查：
  // 把已套用的 delta 反推太麻煩，改用目前長度 + 併發 delta 的總長度當寬鬆上限
  const limit =
    otContentLength(content) +
    concurrent.reduce((n, c) => n + deltaBaseLength(c.delta) + deltaInsertLength(c.delta), 0);
  const incoming = assertValidDelta(input.delta, limit);

  // 逐一 transform，把 client 的 delta 推進到最新版本
  let d = asCoreDelta(incoming);
  for (const c of concurrent) d = transform(d, asCoreDelta(c.delta), false);
  const transformed = normalizeDelta(d);

  if (isNoop(transformed)) {
    // 整個 delta 都被 transform 掉了（例如那段字已經被別人刪光）→ 不推進 rev
    return {
      transformed: asSharedDelta(transformed),
      rev: currentRev,
      content,
      changed: false,
      previous: content,
    };
  }

  const nextContent = asShared(applyDelta(asCore(content), transformed));
  const nextRev = currentRev + 1;

  await insertBlockDelta(tx, {
    blockId: input.blockId,
    rev: nextRev,
    delta: asSharedDelta(transformed),
    actorId: input.actorId,
  });
  await writeBlockContentAndRev(tx, {
    blockId: input.blockId,
    content: nextContent,
    rev: nextRev,
    actorId: input.actorId,
  });

  return {
    transformed: asSharedDelta(transformed),
    rev: nextRev,
    content: nextContent,
    changed: true,
    previous: content,
  };
}

/**
 * `block.update{content}` 也要在 block_deltas 留一筆（ADR 0006 §2.6）。
 *
 * 為什麼不能略過：兩條通道（tx / delta）都會改同一個 block 的 content。
 * 如果 `block.update` 不推進 rev，某個 client 用舊 baseRev 送來的 delta
 * 就會被套在「已經被整段覆蓋」的內容上，offset 全錯。
 * 把整段覆蓋也表示成一個 delta（用 `deltaFromDiff` 壓成最小差異）之後，
 * 兩條通道就在同一條 rev 線上，transform 窗口永遠是完整的。
 */
export async function recordContentUpdateAsDelta(
  tx: Tx,
  input: { blockId: string; before: RichText; after: RichText; actorId: string },
): Promise<number | null> {
  const delta = deltaFromDiff(asCore(input.before), asCore(input.after));
  if (isNoop(delta)) return null;
  const block = await lockBlockForDelta(tx, input.blockId);
  if (!block) return null;
  const nextRev = Number(block.rev ?? 0) + 1;
  await insertBlockDelta(tx, {
    blockId: input.blockId,
    rev: nextRev,
    delta: asSharedDelta(delta),
    actorId: input.actorId,
  });
  await bumpBlockRev(tx, input.blockId, nextRev);
  return nextRev;
}

/** 兩段內容的最小差異（廣播 `block.update{content}` 時改用 delta 表示）。 */
export function contentDeltaOf(before: RichText, after: RichText): OtDelta {
  return asSharedDelta(deltaFromDiff(asCore(before), asCore(after)));
}

function deltaInsertLength(delta: OtDelta): number {
  let n = 0;
  for (const op of delta.ops) {
    const insert = (op as { insert?: string }).insert;
    if (typeof insert === 'string') n += [...insert].length;
  }
  return n;
}

function deltaBaseLength(delta: OtDelta): number {
  let n = 0;
  for (const op of delta.ops) {
    const retain = (op as { retain?: number }).retain;
    const del = (op as { delete?: number }).delete;
    if (typeof retain === 'number') n += retain;
    else if (typeof del === 'number') n += del;
  }
  return n;
}

export type { BlockOtState };
