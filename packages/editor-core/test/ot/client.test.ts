/**
 * Client 三狀態機（04 §6.6.3）的行為測試。
 * 全部在 Node 跑，沒有 DOM、沒有網路 —— 這正是把狀態機做成純邏輯的理由。
 */
import { describe, expect, it } from 'vitest';
import { OtClient } from '../../src/ot/client.js';
import { apply, normalizeDelta } from '../../src/ot/delta.js';
import type { OtDelta } from '../../src/ot/types.js';
import { fromPlainText, toPlainText } from '../../src/text/richtext.js';

interface Harness {
  client: OtClient;
  sent: Array<{ delta: OtDelta; baseRev: number }>;
  applied: OtDelta[];
  desyncs: Array<{ reason: string; expected: number; got: number }>;
  states: string[];
  /** 本地文件（applyLocal 之前呼叫端自己要套用，這裡幫忙做掉） */
  doc: () => string;
  local(delta: OtDelta): void;
}

function harness(initial = 'abc', rev = 0): Harness {
  let content = fromPlainText(initial);
  const sent: Array<{ delta: OtDelta; baseRev: number }> = [];
  const applied: OtDelta[] = [];
  const desyncs: Array<{ reason: string; expected: number; got: number }> = [];
  const states: string[] = [];
  const client = new OtClient({
    rev,
    applyDelta: (d) => {
      applied.push(d);
      content = apply(content, d);
    },
    sendDelta: (delta, baseRev) => sent.push({ delta, baseRev }),
    onDesync: (reason, detail) => desyncs.push({ reason, ...detail }),
    onStateChange: (s) => states.push(s),
  });
  return {
    client,
    sent,
    applied,
    desyncs,
    states,
    doc: () => toPlainText(content),
    local(delta) {
      content = apply(content, delta);
      client.applyLocal(delta);
    },
  };
}

const insertAt = (at: number, text: string): OtDelta =>
  at > 0 ? { ops: [{ retain: at }, { insert: text }] } : { ops: [{ insert: text }] };

describe('OtClient 狀態轉移', () => {
  it('Synchronized：本地編輯 → 立刻送出 → AwaitingConfirm', () => {
    const h = harness();
    expect(h.client.state).toBe('synchronized');
    h.local(insertAt(3, 'd'));
    expect(h.client.state).toBe('awaitingConfirm');
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.baseRev).toBe(0);
    expect(h.doc()).toBe('abcd');
  });

  it('AwaitingConfirm：再編輯 → 進 buffer，不重複送出', () => {
    const h = harness();
    h.local(insertAt(3, 'd'));
    h.local(insertAt(4, 'e'));
    expect(h.client.state).toBe('awaitingWithBuffer');
    expect(h.sent).toHaveLength(1);
    expect(h.doc()).toBe('abcde');
  });

  it('AwaitingWithBuffer：再編輯 → compose 進同一個 buffer', () => {
    const h = harness();
    h.local(insertAt(3, 'd'));
    h.local(insertAt(4, 'e'));
    h.local(insertAt(5, 'f'));
    expect(h.client.state).toBe('awaitingWithBuffer');
    // buffer 的基準是「outstanding 已套用之後」的文件（abcd），所以 retain 是 4
    expect(normalizeDelta(h.client.buffer!)).toEqual({ ops: [{ retain: 4 }, { insert: 'ef' }] });
    expect(h.sent).toHaveLength(1);
  });

  it('收到 ack → 回 Synchronized 並推進 rev', () => {
    const h = harness();
    h.local(insertAt(3, 'd'));
    h.client.applyAck(1);
    expect(h.client.state).toBe('synchronized');
    expect(h.client.rev).toBe(1);
    expect(h.client.outstanding).toBeNull();
  });

  it('AwaitingWithBuffer 收到 ack → 送出 buffer 並回到 AwaitingConfirm', () => {
    const h = harness();
    h.local(insertAt(3, 'd'));
    h.local(insertAt(4, 'e'));
    h.client.applyAck(1);
    expect(h.client.state).toBe('awaitingConfirm');
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.baseRev).toBe(1);
    expect(normalizeDelta(h.sent[1]!.delta)).toEqual({ ops: [{ retain: 4 }, { insert: 'e' }] });
  });

  it('Synchronized 收到遠端 delta → 直接套用', () => {
    const h = harness();
    h.client.applyRemote(insertAt(0, 'Z'), 1);
    expect(h.doc()).toBe('Zabc');
    expect(h.client.rev).toBe(1);
  });

  it('AwaitingConfirm 收到遠端 delta → 雙向 transform，兩人的字都在', () => {
    const h = harness('abc');
    h.local(insertAt(3, '!')); // 本地在句尾
    h.client.applyRemote(insertAt(0, 'Z'), 1); // 遠端在句首
    expect(h.doc()).toBe('Zabc!');
    // outstanding 也被推後了，重送時位置才會對
    expect(normalizeDelta(h.client.outstanding!)).toEqual({ ops: [{ retain: 4 }, { insert: '!' }] });
  });

  it('AwaitingWithBuffer 收到遠端 delta → outstanding 與 buffer 都被 transform', () => {
    const h = harness('abc');
    h.local(insertAt(3, 'X'));
    h.local(insertAt(4, 'Y'));
    h.client.applyRemote(insertAt(0, 'Z'), 1);
    expect(h.doc()).toBe('ZabcXY');
    expect(normalizeDelta(h.client.outstanding!)).toEqual({ ops: [{ retain: 4 }, { insert: 'X' }] });
    expect(normalizeDelta(h.client.buffer!)).toEqual({ ops: [{ retain: 5 }, { insert: 'Y' }] });
  });

  it('同位置 insert：遠端（已被伺服器套用的那一邊）優先', () => {
    const h = harness('ab');
    h.local(insertAt(1, 'L'));
    h.client.applyRemote(insertAt(1, 'R'), 1);
    expect(h.doc()).toBe('aRLb');
  });

  it('重複的遠端廣播會被忽略', () => {
    const h = harness();
    h.client.applyRemote(insertAt(0, 'Z'), 1);
    const again = h.client.applyRemote(insertAt(0, 'Z'), 1);
    expect(again).toBeNull();
    expect(h.doc()).toBe('Zabc');
  });

  it('rev 有洞 → 通知宿主 desync', () => {
    const h = harness();
    h.client.applyRemote(insertAt(0, 'Z'), 5);
    expect(h.desyncs[0]).toEqual({ reason: 'gap', expected: 1, got: 5 });
  });

  it('resend 會用目前的 rev 重送 outstanding', () => {
    const h = harness();
    h.local(insertAt(3, 'd'));
    h.client.applyRemote(insertAt(0, 'Z'), 1);
    h.client.resend();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.baseRev).toBe(1);
  });

  it('abortPending 會把 outstanding 與 buffer 合成一個可回滾的 delta', () => {
    const h = harness();
    h.local(insertAt(3, 'd'));
    h.local(insertAt(4, 'e'));
    const pending = h.client.abortPending();
    expect(normalizeDelta(pending)).toEqual({ ops: [{ retain: 3 }, { insert: 'de' }] });
    expect(h.client.state).toBe('synchronized');
  });

  it('resetRev 只在 Synchronized 時生效', () => {
    const h = harness();
    h.client.resetRev(9);
    expect(h.client.rev).toBe(9);
    h.local(insertAt(3, 'd'));
    h.client.resetRev(100);
    expect(h.client.rev).toBe(9);
  });
});

describe('兩個 client + 伺服器：兩人的字都保留（M6 驗收標準）', () => {
  it('A 與 B 同時在同一段文字打字，收斂到同一份內容', () => {
    const a = harness('kennote', 0);
    const b = harness('kennote', 0);

    // A 在句尾打字、B 在句首打字（同一個 rev 出發）
    a.local({ ops: [{ retain: 7 }, { insert: ' 很好用' }] });
    b.local({ ops: [{ insert: '我覺得 ' }] });

    // 伺服器先收到 A（rev 1），再收到 B（baseRev 0 → 對 A 做 transform）
    a.client.applyAck(1);
    b.client.applyRemote(a.sent[0]!.delta, 1); // B 收到 A 的廣播

    // B 的 outstanding 已被 transform，伺服器套用後 rev = 2
    const bTransformed = b.client.outstanding!;
    b.client.applyAck(2);
    a.client.applyRemote(bTransformed, 2); // A 收到 B 的廣播

    expect(a.doc()).toBe(b.doc());
    expect(a.doc()).toBe('我覺得 kennote 很好用');
  });
});

/**
 * BUG-4（`docs/qa/functional-round1.md`）：markdown 捷徑的「整段覆寫」發生時，
 * OT buffer 裡還躺著一筆沒送出的 delta（空白鍵那一下）。
 *
 * 修法（ADR 0006 §2.9）：整段覆寫本身也要以 delta 的形式進同一條 rev 線 ——
 * 於是它會被 `compose` 進 buffer，把那一筆「不該存在的歷史」就地抵銷掉。
 */
describe('buffer 裡有 delta 時發生整段覆寫（BUG-4）', () => {
  it('本地整段覆寫會 compose 進 buffer，伺服器最終內容 = 使用者所見', () => {
    const h = harness('', 0);
    let server = fromPlainText(''); // 伺服器端的內容（rev 0）
    const serverApply = (d: OtDelta): void => {
      server = apply(server, d);
    };

    h.local(insertAt(0, '>')); // 打 ">"  → 立刻送出（outstanding）
    h.local(insertAt(1, ' ')); // 打空白  → 進 buffer
    h.local({ ops: [{ delete: 2 }] }); // markdown 捷徑：整段覆寫成空內容
    expect(h.doc()).toBe('');
    expect(h.client.state).toBe('awaitingWithBuffer');

    // 伺服器收到第一筆 → rev 1
    serverApply(h.sent[0]!.delta);
    expect(toPlainText(server)).toBe('>');
    h.client.applyAck(1); // ack → buffer 變成新的 outstanding 並送出

    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.baseRev).toBe(1);
    serverApply(h.sent[1]!.delta);
    h.client.applyAck(2);

    // ⭐ 驗收：伺服器內容 === 使用者看到的內容（不會多出一個前綴 '>'）
    expect(toPlainText(server)).toBe('');
    expect(h.doc()).toBe('');

    // 接著繼續打字，兩邊仍然一致
    h.local(insertAt(0, 'quote'));
    serverApply(h.sent[2]!.delta);
    h.client.applyAck(3);
    expect(toPlainText(server)).toBe('quote');
    expect(h.doc()).toBe('quote');
  });

  it('別人的整段覆寫（伺服器轉成 delta 廣播）會同時 transform outstanding 與 buffer', () => {
    const h = harness('abc', 0);
    h.local(insertAt(3, 'd')); // outstanding
    h.local(insertAt(4, 'e')); // buffer
    expect(h.client.state).toBe('awaitingWithBuffer');

    // 對方把整段換成 "XY"（伺服器用 deltaFromDiff 壓成 delta 後廣播）
    h.client.applyRemote({ ops: [{ delete: 3 }, { insert: 'XY' }] }, 1);

    // 本地文件變成「對方的新內容 + 我還沒被確認的字」
    expect(h.doc()).toBe('XYde');
    // 我手上的兩筆都被推到覆寫之後的座標系上，不會再套在已被刪掉的位置
    expect(normalizeDelta(h.client.outstanding!)).toEqual({ ops: [{ retain: 2 }, { insert: 'd' }] });
    expect(normalizeDelta(h.client.buffer!)).toEqual({ ops: [{ retain: 3 }, { insert: 'e' }] });
    expect(h.client.rev).toBe(1);
  });

  it('dropBuffer：作廢還沒送出的 buffer，狀態退回 AwaitingConfirm', () => {
    const h = harness();
    h.local(insertAt(3, 'd'));
    h.local(insertAt(4, 'e'));
    expect(h.client.state).toBe('awaitingWithBuffer');

    const dropped = h.client.dropBuffer();
    expect(normalizeDelta(dropped!)).toEqual({ ops: [{ retain: 4 }, { insert: 'e' }] });
    expect(h.client.buffer).toBeNull();
    expect(h.client.state).toBe('awaitingConfirm');

    // ack 之後不會再送出任何東西（buffer 已經作廢）
    h.client.applyAck(1);
    expect(h.sent).toHaveLength(1);
    expect(h.client.state).toBe('synchronized');
  });

  it('observeRev：另一條通道推進 rev 之後，下一筆 delta 用新的 baseRev', () => {
    const h = harness('abc', 3);
    h.client.observeRev(5); // block.update{content} 被伺服器記成 rev 5
    expect(h.client.rev).toBe(5);
    h.client.observeRev(4); // 不會倒退
    expect(h.client.rev).toBe(5);
    h.local(insertAt(3, 'd'));
    expect(h.sent[0]!.baseRev).toBe(5);
  });
});
