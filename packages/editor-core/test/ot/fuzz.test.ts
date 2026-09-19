/**
 * 三方模糊測試模擬器（04 §6.6.5 最後一段、§8 M6 驗收標準）。
 *
 * > 模擬 3 個 client 隨機編輯 + 隨機延遲送達，跑 10000 輪後檢查三方文件是否完全一致。
 * > 這比任何手寫測試都有效。
 *
 * 模擬的是**真實的網路**，不是理想網路：
 *   - 隨機延遲：每則訊息隨機延後 0–6 輪才送達
 *   - 亂序：三條連線各自獨立延遲，所以不同 client 看到的事件順序不同
 *     （同一條連線內部仍維持 FIFO —— WebSocket 本來就保證這件事，
 *      如果連這個都亂掉，任何 OT 都不可能收斂）
 *   - 斷線：client 隨機斷線數輪，期間不收不送；重連後補齊 + 重送 outstanding
 *   - 重送：重連時重送同一個 txId，伺服器冪等（回上次的 ack）
 *
 * 通過條件：跑完之後把所有訊息排空，三個 client 的文件與伺服器**完全一致**
 * （逐字元比較，不是長度比較）。
 */
import { describe, expect, it } from 'vitest';
import { apply } from '../../src/ot/delta.js';
import { transformAgainstAll } from '../../src/ot/transform.js';
import { OtClient } from '../../src/ot/client.js';
import type { OtDelta } from '../../src/ot/types.js';
import type { Mark, RichText } from '../../src/model/types.js';
import { length as rtLength, normalize, toPlainText } from '../../src/text/richtext.js';
import { mulberry32 } from './arbitraries.js';

const ROUNDS = Number(process.env.OT_FUZZ_ROUNDS ?? 10_000);
const CLIENTS = 3;
const ALPHABET = 'abcdefghij';
const MARKS: Mark[] = [{ t: 'b' }, { t: 'i' }, { t: 'code' }, { t: 'link', href: 'k' }];

/* ── 訊息 ───────────────────────────────────────────────── */

interface Submit {
  txId: string;
  from: number;
  delta: OtDelta;
  baseRev: number;
}
type Downstream =
  | { t: 'ack'; txId: string; rev: number }
  | { t: 'broadcast'; delta: OtDelta; rev: number };

/** 單向 FIFO 連線：訊息可以延遲，但絕不會互相超車。 */
class Link<T> {
  private readonly queue: Array<{ readyAt: number; payload: T }> = [];
  private lastReadyAt = -1;

  constructor(private readonly rnd: () => number) {}

  send(payload: T, now: number): void {
    const readyAt = Math.max(this.lastReadyAt + 1, now + Math.floor(this.rnd() * 7));
    this.lastReadyAt = readyAt;
    this.queue.push({ readyAt, payload });
  }

  /** 取出所有「已經到期」的訊息（FIFO；前面那則沒到期，後面的也不能先過）。 */
  drain(now: number, limit = Infinity): T[] {
    const out: T[] = [];
    while (this.queue.length > 0 && this.queue[0]!.readyAt <= now && out.length < limit) {
      out.push(this.queue.shift()!.payload);
    }
    return out;
  }

  /** 不管到期時間，全部放行（收尾用）。 */
  drainAll(): T[] {
    const out = this.queue.map((m) => m.payload);
    this.queue.length = 0;
    this.lastReadyAt = -1;
    return out;
  }

  get pending(): number {
    return this.queue.length;
  }
}

/* ── 伺服器 ─────────────────────────────────────────────── */

class FakeServer {
  content: RichText;
  rev = 0;
  /** history[i] = 把文件從 rev i 推進到 rev i+1 的 delta */
  readonly history: OtDelta[] = [];
  /** 冪等：txId → 已經算好的結果 */
  private readonly applied = new Map<string, { rev: number; delta: OtDelta }>();

  constructor(initial: RichText) {
    this.content = normalize(initial);
  }

  /** 04 §6.6.4 的 receiveDelta（這裡沒有 DB，邏輯完全相同）。 */
  receive(msg: Submit): { rev: number; delta: OtDelta; duplicate: boolean } {
    const seen = this.applied.get(msg.txId);
    if (seen) return { ...seen, duplicate: true };

    // 取出 client 沒看過的所有 delta，逐一 transform
    const concurrent = this.history.slice(msg.baseRev);
    const d = transformAgainstAll(msg.delta, concurrent);
    this.content = apply(this.content, d);
    this.rev += 1;
    this.history.push(d);
    const result = { rev: this.rev, delta: d };
    this.applied.set(msg.txId, result);
    return { ...result, duplicate: false };
  }
}

/* ── Client ─────────────────────────────────────────────── */

class FakeClient {
  content: RichText;
  readonly ot: OtClient;
  /** 已經處理過的 ack（重送造成的重複 ack 要忽略） */
  private readonly ackedTxIds = new Set<string>();
  private pendingTxId: string | null = null;
  private lastSent: Submit | null = null;
  offline = false;

  constructor(
    readonly id: number,
    initial: RichText,
    private readonly upLink: Link<Submit>,
    private readonly now: () => number,
    private readonly nextTxId: () => string,
  ) {
    this.content = normalize(initial);
    this.ot = new OtClient({
      rev: 0,
      applyDelta: (delta) => {
        this.content = apply(this.content, delta);
      },
      sendDelta: (delta, baseRev) => {
        const txId = this.nextTxId();
        this.pendingTxId = txId;
        const msg: Submit = { txId, from: this.id, delta, baseRev };
        this.lastSent = msg;
        if (!this.offline) this.upLink.send(msg, this.now());
      },
    });
  }

  edit(delta: OtDelta): void {
    this.content = apply(this.content, delta);
    this.ot.applyLocal(delta);
  }

  receive(msg: Downstream): void {
    if (msg.t === 'broadcast') {
      this.ot.applyRemote(msg.delta, msg.rev);
      return;
    }
    if (this.ackedTxIds.has(msg.txId)) return; // 重送造成的重複 ack
    this.ackedTxIds.add(msg.txId);
    if (msg.txId !== this.pendingTxId) return;
    this.pendingTxId = null;
    this.ot.applyAck(msg.rev);
  }

  /** 重連：重送還沒被 ack 的那一筆（txId 不變 → 伺服器冪等）。 */
  reconnect(): void {
    this.offline = false;
    if (this.pendingTxId && this.lastSent) this.upLink.send(this.lastSent, this.now());
  }

  get hasPending(): boolean {
    return this.ot.isPending;
  }
}

/* ── 隨機編輯 ───────────────────────────────────────────── */

function randomEdit(rnd: () => number, content: RichText): OtDelta | null {
  const len = rtLength(content);
  // 文件太長時提高刪除比例，讓長度在 0–400 之間震盪
  // （不控制的話 10,000 輪會長到上萬字，測的就變成 slice 的效能而不是 OT 的正確性）
  const insertBias = len > 400 ? 0.15 : len > 200 ? 0.35 : 0.5;
  const roll = rnd();
  const at = len === 0 ? 0 : Math.floor(rnd() * (len + 1));

  if (roll < insertBias || len === 0) {
    // 插入 1–3 個字
    const n = 1 + Math.floor(rnd() * 3);
    let text = '';
    for (let i = 0; i < n; i += 1) text += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
    const withMark = rnd() < 0.25;
    const insert = withMark
      ? { insert: text, marks: [MARKS[Math.floor(rnd() * MARKS.length)]!] }
      : { insert: text };
    return at > 0 ? { ops: [{ retain: at }, insert] } : { ops: [insert] };
  }
  if (roll < insertBias + 0.4) {
    // 刪除 1–3 個字
    const start = Math.min(at, len - 1);
    const n = Math.min(1 + Math.floor(rnd() * 3), len - start);
    if (n <= 0) return null;
    return start > 0 ? { ops: [{ retain: start }, { delete: n }] } : { ops: [{ delete: n }] };
  }
  // 套格式
  const start = Math.min(at, len - 1);
  const n = Math.min(1 + Math.floor(rnd() * 3), len - start);
  if (n <= 0) return null;
  const mark = MARKS[Math.floor(rnd() * MARKS.length)]!;
  const patch = rnd() < 0.5 ? { add: [mark] } : { remove: [mark] };
  return start > 0
    ? { ops: [{ retain: start }, { retain: n, marks: patch }] }
    : { ops: [{ retain: n, marks: patch }] };
}

/* ── 模擬器 ─────────────────────────────────────────────── */

interface FuzzResult {
  rounds: number;
  serverRev: number;
  edits: number;
  disconnects: number;
  resends: number;
  finalText: string;
  converged: boolean;
}

export function runFuzz(seed: number, rounds: number): FuzzResult {
  const rnd = mulberry32(seed);
  let now = 0;
  let txCounter = 0;
  const nextTxId = () => `tx${(txCounter += 1)}`;

  const initial = normalize([{ text: 'kennote' }]);
  const server = new FakeServer(initial);
  const up = Array.from({ length: CLIENTS }, () => new Link<Submit>(rnd));
  const down = Array.from({ length: CLIENTS }, () => new Link<Downstream>(rnd));
  const clients = Array.from(
    { length: CLIENTS },
    (_, i) => new FakeClient(i, initial, up[i]!, () => now, nextTxId),
  );

  const deliverUp = (msg: Submit): void => {
    const result = server.receive(msg);
    down[msg.from]!.send({ t: 'ack', txId: msg.txId, rev: result.rev }, now);
    if (!result.duplicate) {
      for (let i = 0; i < CLIENTS; i += 1) {
        if (i === msg.from) continue;
        down[i]!.send({ t: 'broadcast', delta: result.delta, rev: result.rev }, now);
      }
    }
  };

  let edits = 0;
  let disconnects = 0;
  let resends = 0;
  const offlineUntil = new Array<number>(CLIENTS).fill(-1);

  for (let round = 0; round < rounds; round += 1) {
    now = round;

    // 1) 斷線 / 重連
    for (let i = 0; i < CLIENTS; i += 1) {
      if (clients[i]!.offline && round >= offlineUntil[i]!) {
        clients[i]!.reconnect();
        resends += 1;
      } else if (!clients[i]!.offline && rnd() < 0.002) {
        clients[i]!.offline = true;
        offlineUntil[i] = round + 1 + Math.floor(rnd() * 20);
        disconnects += 1;
      }
    }

    // 2) 本地編輯（順序隨機，模擬三個人同時打字）
    const order = [0, 1, 2].sort(() => rnd() - 0.5);
    for (const i of order) {
      if (rnd() >= 0.35) continue;
      const delta = randomEdit(rnd, clients[i]!.content);
      if (!delta) continue;
      clients[i]!.edit(delta);
      edits += 1;
    }

    // 3) 送達 client → server（斷線的 client 不送）
    for (let i = 0; i < CLIENTS; i += 1) {
      if (clients[i]!.offline) continue;
      for (const msg of up[i]!.drain(now)) deliverUp(msg);
    }

    // 4) 送達 server → client（斷線的 client 收不到，訊息留在連線裡）
    for (let i = 0; i < CLIENTS; i += 1) {
      if (clients[i]!.offline) continue;
      for (const msg of down[i]!.drain(now)) clients[i]!.receive(msg);
    }
  }

  // 5) 收尾：全部上線，把所有訊息排空，直到沒有任何一方還有未確認的東西
  for (const c of clients) {
    if (c.offline) c.reconnect();
  }
  for (let guard = 0; guard < 10_000; guard += 1) {
    let moved = false;
    for (let i = 0; i < CLIENTS; i += 1) {
      for (const msg of up[i]!.drainAll()) {
        deliverUp(msg);
        moved = true;
      }
    }
    for (let i = 0; i < CLIENTS; i += 1) {
      for (const msg of down[i]!.drainAll()) {
        clients[i]!.receive(msg);
        moved = true;
      }
    }
    if (!moved && !clients.some((c) => c.hasPending)) break;
  }

  const serverText = JSON.stringify(normalize(server.content));
  const converged = clients.every((c) => JSON.stringify(normalize(c.content)) === serverText);

  return {
    rounds,
    serverRev: server.rev,
    edits,
    disconnects,
    resends,
    finalText: toPlainText(server.content),
    converged,
  };
}

describe('三方模糊測試模擬器', () => {
  it(
    `3 個 client + 中央伺服器，隨機延遲/亂序/斷線重送，跑 ${ROUNDS.toLocaleString('en-US')} 輪後三份文件與伺服器完全一致`,
    () => {
      const result = runFuzz(0x6b656e6e, ROUNDS);
      // 這些數字只是「測試真的有在做事」的佐證，不是斷言目標
      expect(result.edits).toBeGreaterThan(ROUNDS / 2);
      expect(result.serverRev).toBeGreaterThan(100);
      expect(result.disconnects).toBeGreaterThan(0);
      expect(result.converged).toBe(true);
    },
    600_000,
  );

  it(
    '換 8 組隨機種子各跑 1,000 輪也都收斂',
    () => {
      for (let seed = 1; seed <= 8; seed += 1) {
        const result = runFuzz(seed * 7919, 1_000);
        expect(result.converged, `seed ${seed} 沒有收斂`).toBe(true);
      }
    },
    600_000,
  );
});
