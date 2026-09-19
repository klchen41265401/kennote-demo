/**
 * OT 的前端接線層（04 §6.6.3、§8 M6 第 3 / 6 項）。
 *
 * 分層（與 sync-client 同一套紀律）：
 *   editor-core/src/ot/client.ts  三狀態機**純邏輯**（一個 block 一個實例，可在 Node 測）
 *   lib/ot-client.ts              這個檔案：一整頁的 block → OtClient 對照表 + 與 sync-client 的接線
 *   features/editor/useEditorHost 只負責把 editor 的事件接過來
 *
 * 這個檔案**不 import React、不 import store**，所以可以用假的 transport 在 Node 完整測試。
 *
 * ── 兩條通道（ADR 0006 §2.5）────────────────────────────────
 *   delta 通道：同一個 block 內的**文字變更** → `text.delta`（走 OT）
 *   tx 通道   ：結構變更（新增/刪除/搬移/換型別/改 props）→ 原本的 LWW transaction
 * 兩條通道共用同一條 WebSocket 與同一支 `applyTransaction()`，
 * 所以伺服器端的順序是單一且權威的；不需要第二套協定。
 */
import { OtClient, type OtDelta } from '@kennote/editor-core';
import type { Operation } from '@kennote/shared-types';
import { isTextDeltaOperation, type TextDeltaOperation } from '@kennote/shared-types';

export interface OtChannelTransport {
  /** 送出一筆 delta，回傳這筆的 txId（用來對 ack / 拒絕）。 */
  submitDelta(blockId: string, delta: OtDelta, baseRev: number): string;
}

export interface OtChannelHooks {
  /** 把（已 transform 的）遠端 delta 套到編輯器上。 */
  applyRemoteDelta(blockId: string, delta: OtDelta): void;
  /** rev 對不上 / 伺服器拒絕 → 宿主重抓 snapshot。 */
  onDesync(reason: string, blockId: string): void;
}

export interface OtPageChannelOptions extends OtChannelTransport, OtChannelHooks {}

interface BlockEntry {
  client: OtClient;
  /** 目前飛行中的 txId（重複 ack 要忽略） */
  pendingTxId: string | null;
  ackedTxIds: Set<string>;
}

/**
 * 一整頁的 OT 通道。
 *
 * 每個 block 各有一個獨立的三狀態機 —— block 之間的文字編輯**本來就不衝突**
 * （04 §6.6：operation 粒度就是 block），所以不需要跨 block 的協調。
 */
export class OtPageChannel {
  private readonly blocks = new Map<string, BlockEntry>();
  private readonly initialRevs = new Map<string, number>();
  private readonly options: OtPageChannelOptions;

  constructor(options: OtPageChannelOptions) {
    this.options = options;
  }

  /** 從 snapshot 帶進每個 block 的起始 rev（`blocks.rev`，migration 0030）。 */
  setInitialRevs(revs: Record<string, number>): void {
    for (const [blockId, rev] of Object.entries(revs)) {
      this.initialRevs.set(blockId, rev);
      const entry = this.blocks.get(blockId);
      if (entry) entry.client.resetRev(rev);
    }
  }

  /** 編輯器建 `text.delta` op 時要填的 baseRev。 */
  getBaseRev(blockId: string): number {
    const entry = this.blocks.get(blockId);
    if (entry) return entry.client.rev;
    return this.initialRevs.get(blockId) ?? 0;
  }

  getState(blockId: string): 'synchronized' | 'awaitingConfirm' | 'awaitingWithBuffer' {
    return this.blocks.get(blockId)?.client.state ?? 'synchronized';
  }

  /** 還有沒有沒送出去的 delta（切頁前要等的東西）。 */
  get hasPending(): boolean {
    for (const entry of this.blocks.values()) if (entry.client.isPending) return true;
    return false;
  }

  private entryFor(blockId: string): BlockEntry {
    const existing = this.blocks.get(blockId);
    if (existing) return existing;
    const entry: BlockEntry = {
      pendingTxId: null,
      ackedTxIds: new Set(),
      client: new OtClient({
        rev: this.initialRevs.get(blockId) ?? 0,
        applyDelta: (delta) => this.options.applyRemoteDelta(blockId, delta),
        sendDelta: (delta, baseRev) => {
          entry.pendingTxId = this.options.submitDelta(blockId, delta, baseRev);
        },
        onDesync: (reason) => this.options.onDesync(reason, blockId),
      }),
    };
    this.blocks.set(blockId, entry);
    return entry;
  }

  /**
   * 本地產生的 `text.delta`（編輯器已經套到畫面上了）。
   * 由三狀態機決定要立刻送出還是先進 buffer。
   */
  submitLocal(op: TextDeltaOperation): void {
    if (op.delta.ops.length === 0) return;
    this.entryFor(op.blockId).client.applyLocal(op.delta);
  }

  /** 從編輯器的 `localOps` 一次吃一整批（非 text.delta 的交給呼叫端走 tx 通道）。 */
  submitLocalOps(ops: Operation[]): Operation[] {
    const rest: Operation[] = [];
    for (const op of ops) {
      if (isTextDeltaOperation(op)) this.submitLocal(op);
      else rest.push(op);
    }
    return rest;
  }

  /** 伺服器確認了我們送出的 delta（`TransactionResult.ops` 裡的 text.delta）。 */
  handleAck(op: TextDeltaOperation, txId: string): void {
    const entry = this.blocks.get(op.blockId);
    if (!entry) return;
    if (entry.ackedTxIds.has(txId)) return; // WS + HTTP 都回了一次
    entry.ackedTxIds.add(txId);
    if (entry.pendingTxId && entry.pendingTxId !== txId) return;
    entry.pendingTxId = null;
    // rev 沒推進（delta 被 transform 成 no-op）→ 只要確認 outstanding 即可
    entry.client.applyAck(op.rev ?? entry.client.rev + 1);
  }

  /** 別人送出的 delta（伺服器已套用並 transform 過）。 */
  handleRemote(op: TextDeltaOperation): void {
    const rev = op.rev ?? this.getBaseRev(op.blockId) + 1;
    this.entryFor(op.blockId).client.applyRemote(op.delta, rev);
  }

  /** 伺服器拒絕（4xx）→ 放棄未確認的內容，交給宿主重抓整頁。 */
  handleReject(blockId: string, reason: string): void {
    const entry = this.blocks.get(blockId);
    if (!entry) return;
    entry.client.abortPending();
    entry.pendingTxId = null;
    this.options.onDesync(reason, blockId);
  }

  /** 重連後重送所有 outstanding（txId 會重新產生，但伺服器本來就冪等於內容）。 */
  resendAll(): void {
    for (const entry of this.blocks.values()) entry.client.resend();
  }

  /** block 被刪掉 / 換頁 → 丟掉狀態。 */
  forget(blockId: string): void {
    this.blocks.delete(blockId);
    this.initialRevs.delete(blockId);
  }

  reset(): void {
    this.blocks.clear();
    this.initialRevs.clear();
  }
}

/* ────────────────────────────────────────────────────────────
 * Feature flag
 * ──────────────────────────────────────────────────────────── */

export interface HealthFeatures {
  ot?: boolean;
  realtime?: boolean;
  publicShare?: boolean;
}

let cachedOtFlag: boolean | null = null;
let inflightProbe: Promise<boolean> | null = null;

/** 開發／e2e 想強制打開就設 `VITE_FEATURE_OT=1`。 */
export function otFlagFromEnv(): boolean {
  const raw = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_FEATURE_OT;
  return raw === '1' || raw === 'true';
}

/**
 * 決定這個分頁要不要走 OT：
 *   1. `VITE_FEATURE_OT=1` → 直接開（不打 API）
 *   2. 否則問 `/api/health` 的 `features.ot`（伺服器的 `FEATURE_OT`）
 *
 * **前後端必須一致**：伺服器關著而前端開著，`text.delta` 會被回 NOT_IMPLEMENTED。
 */
export async function resolveOtEnabled(
  fetchHealth: () => Promise<{ features?: HealthFeatures }>,
): Promise<boolean> {
  if (otFlagFromEnv()) return true;
  if (cachedOtFlag !== null) return cachedOtFlag;
  if (inflightProbe) return inflightProbe;
  inflightProbe = fetchHealth()
    .then((health) => {
      cachedOtFlag = health.features?.ot === true;
      return cachedOtFlag;
    })
    .catch(() => false)
    .finally(() => {
      inflightProbe = null;
    });
  return inflightProbe;
}

/** 已經探測過的結果（同步讀取，避免第一次掛載之後才翻轉導致編輯器重建）。 */
export function getCachedOtFlag(): boolean | null {
  if (otFlagFromEnv()) return true;
  return cachedOtFlag;
}

/** 測試用：清掉快取的 flag。 */
export function resetOtFlagCache(): void {
  cachedOtFlag = null;
  inflightProbe = null;
}
