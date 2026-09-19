/**
 * Client 三狀態機（04 §6.6.3）。**純邏輯、零 DOM、零 I/O**，可以在 Node 裡完整測試。
 *
 * ┌─ Synchronized ──────────────────────────────────────────────┐
 * │  本地無未確認操作。                                           │
 * │  本地編輯 → 送出 → 進入 AwaitingConfirm                       │
 * │  收到遠端 → 直接 apply                                        │
 * └─────────────────────────────────────────────────────────────┘
 *             ↓ 送出 a                    ↑ 收到 ack 且 buffer 空
 * ┌─ AwaitingConfirm(outstanding=a) ────────────────────────────┐
 * │  本地編輯 b → 存入 buffer，進入 AwaitingWithBuffer            │
 * │  收到遠端 r → a' = transform(a, r, false)                     │
 * │               r' = transform(r, a, true)；apply(r')           │
 * │  收到 ack   → 回到 Synchronized                               │
 * └─────────────────────────────────────────────────────────────┘
 *             ↓ 本地又編輯                ↑ 收到 ack（送出 buffer）
 * ┌─ AwaitingWithBuffer(outstanding=a, buffer=b) ───────────────┐
 * │  本地編輯 c → buffer = compose(b, c)                          │
 * │  收到遠端 r → a' = transform(a, r, false); r1 = transform(r, a, true)
 * │               b' = transform(b, r1, false); r2 = transform(r1, b, true)
 * │               apply(r2)；outstanding=a'；buffer=b'            │
 * │  收到 ack   → 送出 buffer，outstanding=buffer，buffer=null    │
 * └─────────────────────────────────────────────────────────────┘
 *
 * **priority 的約定**：已經被伺服器套用的那一邊優先（true），
 * 飛行中的本地 delta 讓位（false）。伺服器的 `receiveDelta` 用同一組約定，
 * 因此兩邊算出來的 transform 結果一定相同 —— 這是收斂的前提。
 */
import { compose } from './delta.js';
import { transform } from './transform.js';
import { EMPTY_DELTA, type OtDelta } from './types.js';

export type OtClientState = 'synchronized' | 'awaitingConfirm' | 'awaitingWithBuffer';

export interface OtClientHooks {
  /** 把（已 transform 的）遠端 delta 套到本地文件上；同時應該 transform 本地游標。 */
  applyDelta(delta: OtDelta): void;
  /** 送出 outstanding delta（帶著它所基於的 rev）。 */
  sendDelta(delta: OtDelta, baseRev: number): void;
  /** rev 不連續（漏收 / 重複）時通知宿主。宿主通常會重抓 snapshot。 */
  onDesync?(reason: 'gap' | 'stale-ack', detail: { expected: number; got: number }): void;
  /** 狀態變化（UI 顯示「同步中」用，可選）。 */
  onStateChange?(state: OtClientState): void;
}

export interface OtClientOptions extends OtClientHooks {
  /** 這個 block 目前對齊到伺服器的哪一個 rev。 */
  rev: number;
}

/**
 * 單一 block 的 OT 客戶端。
 * 一個 block 一個實例；不同 block 完全獨立（block 層級的結構操作仍走 LWW）。
 */
export class OtClient {
  private _state: OtClientState = 'synchronized';
  private _rev: number;
  private _outstanding: OtDelta | null = null;
  private _buffer: OtDelta | null = null;
  private readonly hooks: OtClientHooks;

  constructor(options: OtClientOptions) {
    this._rev = options.rev;
    this.hooks = options;
  }

  get state(): OtClientState {
    return this._state;
  }

  get rev(): number {
    return this._rev;
  }

  get outstanding(): OtDelta | null {
    return this._outstanding;
  }

  get buffer(): OtDelta | null {
    return this._buffer;
  }

  /** 還有沒有沒被伺服器確認的本地變更。 */
  get isPending(): boolean {
    return this._state !== 'synchronized';
  }

  /** 宿主載入 snapshot 之後校正 rev（只有 synchronized 時才允許）。 */
  resetRev(rev: number): void {
    if (this._state !== 'synchronized') return;
    this._rev = rev;
  }

  /**
   * 另一條通道推進了這個 block 的 rev（ADR 0006 §2.6：`block.update{content}`
   * 在伺服器端也會寫進 `block_deltas` 並 `rev + 1`）。
   *
   * 只把 rev 往前對齊，**不碰狀態機**：那一筆內容變更本來就已經在本地文件裡，
   * 不需要再 apply；但下一筆 delta 的 baseRev 必須是新的 rev，否則伺服器會
   * 拿它去和「其實已經包含在我這份內容裡」的 delta 做 transform，offset 就歪了。
   */
  observeRev(rev: number): void {
    if (rev > this._rev) this._rev = rev;
  }

  /**
   * 丟掉還沒送出去的 buffer（整段覆寫把它變成不存在的歷史時用）。
   * 回傳被丟掉的那一份，宿主可以拿去對帳。
   */
  dropBuffer(): OtDelta | null {
    const dropped = this._buffer;
    this._buffer = null;
    if (this._state === 'awaitingWithBuffer') this.setState('awaitingConfirm');
    return dropped;
  }

  private setState(next: OtClientState): void {
    if (this._state === next) return;
    this._state = next;
    this.hooks.onStateChange?.(next);
  }

  /**
   * 本地產生了一個 delta（**呼叫者已經把它套到本地文件上了**）。
   * 這裡只負責決定「現在送出」還是「先進 buffer」。
   */
  applyLocal(delta: OtDelta): void {
    if (delta.ops.length === 0) return;
    switch (this._state) {
      case 'synchronized':
        this._outstanding = delta;
        this.setState('awaitingConfirm');
        this.hooks.sendDelta(delta, this._rev);
        return;
      case 'awaitingConfirm':
        this._buffer = delta;
        this.setState('awaitingWithBuffer');
        return;
      case 'awaitingWithBuffer':
        this._buffer = compose(this._buffer ?? EMPTY_DELTA, delta);
        return;
    }
  }

  /**
   * 收到別人的 delta（伺服器已經套用，rev 為 `rev`）。
   * 回傳「實際套到本地文件上的那個 delta」，宿主可以拿它 transform 游標與 undo stack。
   */
  applyRemote(delta: OtDelta, rev: number): OtDelta | null {
    if (rev <= this._rev) return null; // 重複廣播，忽略
    if (rev !== this._rev + 1) {
      this.hooks.onDesync?.('gap', { expected: this._rev + 1, got: rev });
    }

    let incoming = delta;
    if (this._outstanding) {
      const nextOutstanding = transform(this._outstanding, incoming, false);
      incoming = transform(incoming, this._outstanding, true);
      this._outstanding = nextOutstanding;
    }
    if (this._buffer) {
      const nextBuffer = transform(this._buffer, incoming, false);
      incoming = transform(incoming, this._buffer, true);
      this._buffer = nextBuffer;
    }
    this._rev = rev;
    this.hooks.applyDelta(incoming);
    return incoming;
  }

  /**
   * 伺服器確認了 outstanding（`rev` 是套用後的新版本）。
   * 有 buffer 就立刻把 buffer 送出去。
   */
  applyAck(rev: number): void {
    if (this._state === 'synchronized') {
      // 重複 ack（HTTP 補送 + WS 都回了一次）→ 只推進 rev
      if (rev > this._rev) this._rev = rev;
      return;
    }
    if (rev !== this._rev + 1) {
      this.hooks.onDesync?.('stale-ack', { expected: this._rev + 1, got: rev });
    }
    this._rev = Math.max(rev, this._rev);

    if (this._state === 'awaitingConfirm') {
      this._outstanding = null;
      this.setState('synchronized');
      return;
    }
    // awaitingWithBuffer：buffer 變成新的 outstanding 並送出
    const next = this._buffer ?? EMPTY_DELTA;
    this._buffer = null;
    if (next.ops.length === 0) {
      this._outstanding = null;
      this.setState('synchronized');
      return;
    }
    this._outstanding = next;
    this.setState('awaitingConfirm');
    this.hooks.sendDelta(next, this._rev);
  }

  /**
   * 送出失敗且不會重試（伺服器 4xx）→ 放棄未確認的內容。
   * 回傳需要在本地回滾的 delta 組合，宿主自己決定要不要用（通常直接重抓 snapshot）。
   */
  abortPending(): OtDelta {
    const pending = compose(this._outstanding ?? EMPTY_DELTA, this._buffer ?? EMPTY_DELTA);
    this._outstanding = null;
    this._buffer = null;
    this.setState('synchronized');
    return pending;
  }

  /** 斷線重連後重送 outstanding（txId 相同 → 伺服器冪等）。 */
  resend(): void {
    if (this._outstanding) this.hooks.sendDelta(this._outstanding, this._rev);
  }
}
