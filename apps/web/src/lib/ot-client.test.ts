/**
 * OT 前端接線層（lib/ot-client.ts）+ sync-client 的 delta 通道。
 *
 * 用假的 transport 在 Node 跑完整路徑：
 *   本地編輯 → submitDelta → ack → 遠端 delta → transform → 套用
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { applyDelta, transform, type OtDelta } from '@kennote/editor-core';
import type { RichText } from '@kennote/shared-types';
import { textDeltaOperation, type TextDeltaOperation } from '@kennote/shared-types';
import { OtPageChannel, resetOtFlagCache, resolveOtEnabled } from './ot-client';

const BLOCK = 'b1';

const text = (rt: RichText): string => rt.map((n) => (n as { text?: string }).text ?? '￼').join('');
const core = (rt: RichText) => rt as unknown as Parameters<typeof applyDelta>[0];
const coreDelta = (d: OtDelta) => d as unknown as Parameters<typeof applyDelta>[1];

interface Harness {
  channel: OtPageChannel;
  sent: Array<{ txId: string; blockId: string; delta: OtDelta; baseRev: number }>;
  desyncs: string[];
  doc(): string;
  /** 模擬編輯器：本地套用 + 交給 OT 通道 */
  local(delta: OtDelta): void;
}

function harness(initial = 'hello', rev = 0): Harness {
  let content: RichText = [{ text: initial }];
  const sent: Harness['sent'] = [];
  const desyncs: string[] = [];
  let counter = 0;
  const channel = new OtPageChannel({
    submitDelta: (blockId, delta, baseRev) => {
      const txId = `tx${(counter += 1)}`;
      sent.push({ txId, blockId, delta, baseRev });
      return txId;
    },
    applyRemoteDelta: (_blockId, delta) => {
      content = applyDelta(core(content), coreDelta(delta)) as unknown as RichText;
    },
    onDesync: (reason) => desyncs.push(reason),
  });
  channel.setInitialRevs({ [BLOCK]: rev });
  return {
    channel,
    sent,
    desyncs,
    doc: () => text(content),
    local(delta) {
      content = applyDelta(core(content), coreDelta(delta)) as unknown as RichText;
      channel.submitLocal({ type: 'text.delta', blockId: BLOCK, delta, baseRev: channel.getBaseRev(BLOCK) });
    },
  };
}

const remoteOp = (delta: OtDelta, rev: number): TextDeltaOperation => ({
  type: 'text.delta',
  blockId: BLOCK,
  delta,
  baseRev: rev - 1,
  rev,
});

describe('OtPageChannel', () => {
  it('本地編輯會立刻送出，帶著正確的 baseRev', () => {
    const h = harness('hello', 7);
    h.local({ ops: [{ retain: 5 }, { insert: '!' }] });
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.baseRev).toBe(7);
    expect(h.channel.getState(BLOCK)).toBe('awaitingConfirm');
  });

  it('AwaitingConfirm 期間的編輯進 buffer，ack 之後才送第二筆', () => {
    const h = harness();
    h.local({ ops: [{ retain: 5 }, { insert: 'a' }] });
    h.local({ ops: [{ retain: 6 }, { insert: 'b' }] });
    expect(h.sent).toHaveLength(1);
    expect(h.channel.getState(BLOCK)).toBe('awaitingWithBuffer');

    h.channel.handleAck(remoteOp(h.sent[0]!.delta, 1), h.sent[0]!.txId);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.baseRev).toBe(1);
    expect(h.channel.getState(BLOCK)).toBe('awaitingConfirm');
  });

  it('重複 ack（WS + HTTP 都回）只會被處理一次', () => {
    const h = harness();
    h.local({ ops: [{ retain: 5 }, { insert: 'a' }] });
    const { txId, delta } = h.sent[0]!;
    h.channel.handleAck(remoteOp(delta, 1), txId);
    h.channel.handleAck(remoteOp(delta, 1), txId);
    expect(h.channel.getBaseRev(BLOCK)).toBe(1);
    expect(h.channel.getState(BLOCK)).toBe('synchronized');
  });

  it('遠端 delta 會被 transform 後套用，兩人的字都保留', () => {
    const h = harness('hello');
    h.local({ ops: [{ retain: 5 }, { insert: '!' }] }); // 我在句尾
    h.channel.handleRemote(remoteOp({ ops: [{ insert: 'R' }] }, 1)); // 別人在句首
    expect(h.doc()).toBe('Rhello!');
    expect(h.channel.getBaseRev(BLOCK)).toBe(1);
  });

  it('完整一輪：本地 → 遠端 → ack，最後與伺服器一致', () => {
    const h = harness('kennote');
    h.local({ ops: [{ retain: 7 }, { insert: ' 好用' }] });
    h.channel.handleRemote(remoteOp({ ops: [{ insert: '我說 ' }] }, 1));
    expect(h.doc()).toBe('我說 kennote 好用');
    // 伺服器套用我的（已 transform）版本 → rev 2
    h.channel.handleAck(remoteOp(h.sent[0]!.delta, 2), h.sent[0]!.txId);
    expect(h.channel.getState(BLOCK)).toBe('synchronized');
    expect(h.channel.getBaseRev(BLOCK)).toBe(2);
  });

  it('submitLocalOps 只吃 text.delta，其餘原樣交還給 tx 通道', () => {
    const h = harness();
    const rest = h.channel.submitLocalOps([
      textDeltaOperation(BLOCK, { ops: [{ insert: 'x' }] }, 0),
      { type: 'block.move', blockId: BLOCK, parentId: null, afterId: null },
    ]);
    expect(rest).toHaveLength(1);
    expect(rest[0]!.type).toBe('block.move');
    expect(h.sent).toHaveLength(1);
  });

  it('伺服器拒絕 → 放棄未確認內容並通知宿主重抓', () => {
    const h = harness();
    h.local({ ops: [{ insert: 'x' }] });
    h.channel.handleReject(BLOCK, 'NOT_IMPLEMENTED');
    expect(h.channel.getState(BLOCK)).toBe('synchronized');
    expect(h.desyncs).toEqual(['NOT_IMPLEMENTED']);
  });

  it('rev 有洞 → 通知 desync（宿主重抓 snapshot）', () => {
    const h = harness();
    h.channel.handleRemote(remoteOp({ ops: [{ insert: 'x' }] }, 5));
    expect(h.desyncs).toContain('gap');
  });

  it('hasPending 反映還有沒有未確認的 delta', () => {
    const h = harness();
    expect(h.channel.hasPending).toBe(false);
    h.local({ ops: [{ insert: 'x' }] });
    expect(h.channel.hasPending).toBe(true);
    h.channel.handleAck(remoteOp(h.sent[0]!.delta, 1), h.sent[0]!.txId);
    expect(h.channel.hasPending).toBe(false);
  });

  it('reset 之後 baseRev 回到 0', () => {
    const h = harness('hello', 4);
    expect(h.channel.getBaseRev(BLOCK)).toBe(4);
    h.channel.reset();
    expect(h.channel.getBaseRev(BLOCK)).toBe(0);
  });
});

describe('三個 client 透過同一個假伺服器收斂', () => {
  it('三方同時在同一段文字打字，最後三份文件一致', () => {
    // 極簡的中央伺服器：套用 + 依序 transform（與 ot-service.receiveDelta 同一套邏輯）
    const history: OtDelta[] = [];
    let serverContent: RichText = [{ text: 'abc' }];
    const clients = [harness('abc'), harness('abc'), harness('abc')];

    const submit = (from: number): void => {
      const item = clients[from]!.sent.shift();
      if (!item) return;
      let d = coreDelta(item.delta);
      for (const c of history.slice(item.baseRev)) d = transform(d, coreDelta(c), false);
      const applied = d as unknown as OtDelta;
      serverContent = applyDelta(core(serverContent), d) as unknown as RichText;
      history.push(applied);
      const rev = history.length;
      clients[from]!.channel.handleAck(remoteOp(applied, rev), item.txId);
      for (let i = 0; i < clients.length; i += 1) {
        if (i !== from) clients[i]!.channel.handleRemote(remoteOp(applied, rev));
      }
    };

    clients[0]!.local({ ops: [{ insert: '0' }] });
    clients[1]!.local({ ops: [{ retain: 1 }, { insert: '1' }] });
    clients[2]!.local({ ops: [{ retain: 3 }, { insert: '2' }] });
    submit(0);
    submit(1);
    submit(2);

    const expected = text(serverContent);
    for (const c of clients) expect(c.doc()).toBe(expected);
  });
});

describe('resolveOtEnabled', () => {
  beforeEach(() => resetOtFlagCache());

  it('health 回 features.ot = true → 開啟', async () => {
    await expect(resolveOtEnabled(async () => ({ features: { ot: true } }))).resolves.toBe(true);
  });

  it('health 回 features.ot = false → 關閉', async () => {
    await expect(resolveOtEnabled(async () => ({ features: { ot: false } }))).resolves.toBe(false);
  });

  it('沒有 features 欄位（舊版伺服器）→ 關閉', async () => {
    await expect(resolveOtEnabled(async () => ({}))).resolves.toBe(false);
  });

  it('health 掛掉 → 關閉（不要讓協作功能把整頁弄壞）', async () => {
    await expect(
      resolveOtEnabled(async () => {
        throw new Error('offline');
      }),
    ).resolves.toBe(false);
  });

  it('只會探測一次（結果會被快取）', async () => {
    let calls = 0;
    const probe = async () => {
      calls += 1;
      return { features: { ot: true } };
    };
    await resolveOtEnabled(probe);
    await resolveOtEnabled(probe);
    expect(calls).toBe(1);
  });
});
