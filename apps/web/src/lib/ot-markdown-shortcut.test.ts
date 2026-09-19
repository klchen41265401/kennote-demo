/**
 * BUG-4 的端到端回歸（`docs/qa/functional-round1.md`）：
 * **在空 block 輸入 `> quote` 之後，伺服器上的內容必須等於使用者看到的內容。**
 *
 * 這裡把整條管線都接起來，但全部在 Node/jsdom 裡跑：
 *
 *   真的 Editor（editor-core，OT 模式）
 *     → localOps
 *     → OtPageChannel（三狀態機）+ SyncClient（假 WebSocket）
 *     → MiniServer（複刻 `apply-transaction.ts` + `ot-service.ts` 的語意）
 *
 * 重現的訊框順序與 QA 抓到的完全一樣：
 *
 * ```
 * 1) text.delta  insert ">"          baseRev 0   ← 打 ">"
 * 2) 打空白鍵的 delta 被三狀態機 buffer 住（還沒送）
 * 3) markdown 規則觸發 → 整段覆寫
 * 4) 第一筆的 ack 回來，buffer 才送出去
 * ```
 *
 * 修正前：第 3 步帶著 `content` 走 tx 通道，第 4 步的 delta 被套回已經被覆蓋的內容上
 *         → 伺服器留下前綴字元（`quote>`）。
 * 修正後（ADR 0006 §2.9）：第 3 步的 content 也變成 delta，被 `compose` 進 buffer 就地抵銷。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyDelta,
  createEditor,
  deltaFromDiff,
  isNoop,
  normalizeDelta,
  toPlainText,
  transform,
  type Editor,
  type EditorDoc,
  type OtDelta,
  type RichText,
} from '@kennote/editor-core';
import type { ClientMessage, Operation, ServerMessage, TransactionResult } from '@kennote/shared-types';
import { isTextDeltaOperation, splitDeltaOps, textDeltaOperation } from '@kennote/shared-types';
import { MemoryQueue } from './offline-queue';
import { createSyncClient, type SyncClient, type WebSocketLike } from './sync-client';
import { OtPageChannel } from './ot-client';

const PAGE = '11111111-1111-7111-8111-111111111111';
const B1 = '22222222-2222-7222-8222-222222222222';

/* ── editor-core 與 shared-types 的 RichText 是兩份同構宣告 ── */
type CoreRichText = Parameters<typeof applyDelta>[0];
const core = (rt: RichText): CoreRichText => rt as unknown as CoreRichText;

/* ────────────────────────────────────────────────────────────
 * 假 WebSocket
 * ──────────────────────────────────────────────────────────── */

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  readonly sent: ClientMessage[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  static last(): FakeSocket {
    const s = FakeSocket.instances[FakeSocket.instances.length - 1];
    if (!s) throw new Error('還沒有建立任何連線');
    return s;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessage);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  accept(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** 尚未交給 MiniServer 的 tx 訊框（依送出順序） */
  txFrames(): Array<Extract<ClientMessage, { t: 'tx' }>> {
    return this.sent.filter((m) => m.t === 'tx') as Array<Extract<ClientMessage, { t: 'tx' }>>;
  }
}

/* ────────────────────────────────────────────────────────────
 * MiniServer：`apply-transaction.ts` + `ot-service.ts` 的語意複刻
 * ──────────────────────────────────────────────────────────── */

class MiniServer {
  content: RichText = [];
  rev = 0;
  seq = 10;
  blockType = 'paragraph';
  private readonly log: Array<{ rev: number; delta: OtDelta }> = [];

  text(): string {
    return toPlainText(core(this.content));
  }

  /** `receiveDelta`：對窗口內的併發 delta 逐一 transform，再套用。 */
  private receiveDelta(delta: OtDelta, baseRev: number): OtDelta {
    const base = Math.max(0, Math.min(baseRev, this.rev));
    let d = delta;
    for (const c of this.log.filter((e) => e.rev > base)) d = transform(d, c.delta, false);
    const transformed = normalizeDelta(d);
    if (isNoop(transformed)) return transformed;
    this.content = applyDelta(core(this.content), transformed) as unknown as RichText;
    this.rev += 1;
    this.log.push({ rev: this.rev, delta: transformed });
    return transformed;
  }

  /** ADR 0006 §2.6：`block.update{content}` 也要推進 rev，並以 delta 廣播。 */
  private recordContentUpdate(after: RichText): OtDelta | null {
    const delta = deltaFromDiff(core(this.content), core(after));
    if (isNoop(delta)) return null;
    this.content = after;
    this.rev += 1;
    this.log.push({ rev: this.rev, delta });
    return delta;
  }

  apply(tx: { txId: string; ops: Operation[] }): TransactionResult {
    const emitted: Operation[] = [];
    for (const op of tx.ops) {
      if (isTextDeltaOperation(op)) {
        const before = this.rev;
        const transformed = this.receiveDelta(op.delta as OtDelta, op.baseRev);
        emitted.push(textDeltaOperation(op.blockId, transformed, op.baseRev, this.rev || before));
        continue;
      }
      if (op.type !== 'block.update') {
        emitted.push(op);
        continue;
      }
      const patch = op.patch;
      if (patch.blockType !== undefined) this.blockType = patch.blockType;
      if (patch.content === undefined) {
        emitted.push(op);
        continue;
      }
      const delta = this.recordContentUpdate(patch.content as RichText);
      const rest: typeof patch = {};
      if (patch.blockType !== undefined) rest.blockType = patch.blockType;
      if (patch.props !== undefined) rest.props = patch.props;
      if (Object.keys(rest).length > 0) {
        emitted.push({ type: 'block.update', blockId: op.blockId, patch: rest });
      }
      if (delta) emitted.push(textDeltaOperation(op.blockId, delta, this.rev - 1, this.rev));
    }
    this.seq += 1;
    return {
      txId: tx.txId,
      pageId: PAGE,
      seq: this.seq,
      ops: emitted,
      appliedAt: new Date().toISOString(),
      actorId: 'me',
    };
  }
}

/* ────────────────────────────────────────────────────────────
 * 接線（與 useEditorHost 完全相同的形狀）
 * ──────────────────────────────────────────────────────────── */

function emptyDocWith(text: string): EditorDoc {
  return {
    rootIds: [B1],
    blocks: {
      [B1]: {
        id: B1,
        parentId: null,
        type: 'paragraph',
        props: {},
        content: text ? [{ text }] : [],
        children: [],
        version: 1,
      },
    },
  };
}

interface Harness {
  editor: Editor;
  client: SyncClient;
  channel: OtPageChannel;
  socket: FakeSocket;
  server: MiniServer;
  /** 把還沒處理的 tx 訊框交給 MiniServer，並把 txApplied 送回客戶端 */
  deliver(count?: number): Promise<void>;
  localText(): string;
  destroy(): void;
}

function setup(): Harness {
  FakeSocket.instances.length = 0;
  const server = new MiniServer();
  const client = createSyncClient({
    getToken: () => 'fake-token',
    sessionId: 'my-session',
    url: 'ws://test/ws',
    socketFactory: (url) => new FakeSocket(url),
    queue: new MemoryQueue(),
    debounceMs: 300,
    ackTimeoutMs: 10_000,
    isOnline: () => true,
    random: () => 0.5,
  });
  client.start();
  client.attachPage(PAGE, {}, 10);
  const socket = FakeSocket.last();
  socket.accept();
  socket.emit({ t: 'authOk', userId: 'me', sessionId: 'my-session' });
  socket.emit({ t: 'synced', pageId: PAGE, seq: 10, permission: 'edit' });

  const container = document.createElement('div');
  document.body.appendChild(container);

  // channel 的 callback 只在 editor 建好之後才會被呼叫，所以閉包裡先引用是安全的
  const channel = new OtPageChannel({
    submitDelta: (blockId, delta, baseRev) => client.submitDelta(PAGE, blockId, delta, baseRev),
    applyRemoteDelta: (blockId, delta) => editor.applyRemoteDelta(blockId, delta),
    onDesync: (reason) => {
      throw new Error(`不應該 desync：${reason}`);
    },
  });
  channel.setInitialRevs({ [B1]: 0 });

  const editor: Editor = createEditor({
    container,
    doc: emptyDocWith(''),
    ot: { enabled: true, getBaseRev: (blockId: string) => channel.getBaseRev(blockId) },
  });

  client.attachDeltaChannel(PAGE, {
    onAck: (op, txId) => channel.handleAck(op, txId),
    onRemoteDelta: (op) => channel.handleRemote(op),
    onRejected: (blockId, reason) => {
      throw new Error(`不應該被拒絕：${blockId} ${reason.code}`);
    },
  });

  // ⭐ useEditorHost 的 localOps handler（依原順序分流）
  editor.on('localOps', (ops) => {
    for (const group of splitDeltaOps(ops as unknown as Operation[])) {
      const rest = channel.submitLocalOps(group.ops);
      if (rest.length > 0) client.submit(PAGE, rest);
    }
  });

  let delivered = 0;
  return {
    editor,
    client,
    channel,
    socket,
    server,
    async deliver(count = Number.POSITIVE_INFINITY) {
      const frames = socket.txFrames();
      let n = 0;
      while (delivered < frames.length && n < count) {
        const frame = frames[delivered]!;
        delivered += 1;
        n += 1;
        const result = server.apply(frame.tx);
        socket.emit({ t: 'txApplied', result });
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    localText: () => toPlainText(editor.getBlock(B1)!.content),
    destroy: () => {
      editor.destroy();
      client.stop();
    },
  };
}

/** 模擬使用者打字（editor-core 會把它變成一筆 content 變更）。 */
function typeAt(h: Harness, at: number, s: string): void {
  const plain = h.localText();
  const next = plain.slice(0, at) + s + plain.slice(at);
  h.editor.focusBlock(B1, at);
  h.editor.dispatch({
    ops: [{ type: 'block.update', blockId: B1, patch: { content: next ? [{ text: next }] : [] } }],
    kind: 'insertText',
  });
  h.editor.focusBlock(B1, at + [...s].length);
}

const flushTimers = async (ms: number): Promise<void> => {
  await new Promise((r) => setTimeout(r, ms));
};

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  FakeSocket.instances.length = 0;
});

describe('BUG-4：markdown 捷徑的前綴字元不會留在伺服器上', () => {
  it('QA 抓到的訊框順序：ack 晚於整段覆寫，伺服器內容仍然 = 使用者所見', async () => {
    const h = setup();
    try {
      // 1) 打 ">" → 立刻送出（outstanding）
      typeAt(h, 0, '>');
      await flushTimers(0);
      expect(h.socket.txFrames()).toHaveLength(1);

      // 2) 打空白 → 被三狀態機 buffer 住（沒有新訊框）
      typeAt(h, 1, ' ');
      await flushTimers(0);
      expect(h.socket.txFrames()).toHaveLength(1);
      expect(h.channel.getState(B1)).toBe('awaitingWithBuffer');

      // 3) markdown 規則：`> ` → quote，content 被整段清掉
      //    （這正是 `input/input-rules.ts` 的 `applyBlockInputRule` 產生的那一筆 op）
      h.editor.dispatch({
        ops: [
          { type: 'block.update', blockId: B1, patch: { blockType: 'quote', props: {}, content: [] } },
        ],
        kind: 'structural',
        breakHistory: true,
      });
      await flushTimers(400); // tx 通道的 300ms debounce
      expect(h.localText()).toBe('');

      // 送出去的 block.update **不可以**帶 content（帶了就會和 OT buffer 撞車）
      for (const frame of h.socket.txFrames()) {
        for (const op of frame.tx.ops) {
          if (op.type === 'block.update') expect(op.patch.content).toBeUndefined();
        }
      }

      // 4) 伺服器依序處理；第一筆的 ack 回來之後 buffer 才送出
      await h.deliver();
      await flushTimers(400);
      await h.deliver();
      await flushTimers(0);

      expect(h.server.text()).toBe('');
      expect(h.server.blockType).toBe('quote');

      // 5) 接著打內文，兩邊仍然一致
      typeAt(h, 0, 'quote');
      await flushTimers(400);
      await h.deliver();
      await flushTimers(0);

      expect(h.localText()).toBe('quote');
      expect(h.server.text()).toBe('quote'); // ⭐ 修正前是 'quote>'
      expect(h.channel.getBaseRev(B1)).toBe(h.server.rev);
    } finally {
      h.destroy();
    }
  });

  it('舊形狀（block.update 帶著 content 走 tx 通道）會真的弄壞伺服器內容', async () => {
    // 這一條是「測試本身抓得到 BUG-4」的證明：同一個 MiniServer，
    // 只把第 3 步換回舊的送法，伺服器就會留下前綴字元。
    const h = setup();
    try {
      h.channel.submitLocal({ type: 'text.delta', blockId: B1, delta: { ops: [{ insert: '>' }] }, baseRev: 0 });
      await flushTimers(0);
      h.channel.submitLocal({
        type: 'text.delta',
        blockId: B1,
        delta: { ops: [{ retain: 1 }, { insert: ' ' }] },
        baseRev: 0,
      });
      // 舊形狀：整段覆寫帶著 content 走 tx 通道
      h.client.submit(PAGE, [
        { type: 'block.update', blockId: B1, patch: { blockType: 'quote', content: [] } },
      ]);
      await flushTimers(400);

      await h.deliver(1); // delta ">" 的 ack → buffer 被送出
      await flushTimers(0);
      await h.deliver();
      await flushTimers(0);

      // 使用者看到的是空的引用 block，伺服器上卻留著一個字
      expect(h.server.text()).not.toBe('');
      expect(h.server.text()).toBe(' ');
    } finally {
      h.destroy();
    }
  });
});
