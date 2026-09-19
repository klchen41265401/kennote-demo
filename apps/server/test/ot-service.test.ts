/**
 * 伺服器端 OT（04 §6.6.4、§8 M6 第 4 項）的單元測試。
 *
 * 不需要真的 PostgreSQL：用一個**記憶體版的 Tx**（`FakeTx`）接住 `receiveDelta` 發出的
 * 四種 SQL（鎖 block / 取窗口 / 寫 delta / 寫 content+rev）。
 * 這樣測的是「transform 窗口的取用與推進邏輯」—— 也就是這一層真正會寫錯的地方。
 * 真的打資料庫的版本在 test/integration/ot-delta.test.ts。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDelta, transform } from '@kennote/editor-core';
import type { OtDelta, RichText } from '@kennote/shared-types';
import type { Sql } from '../src/db/sql.js';
import type { Tx } from '../src/db/client.js';
import {
  assertValidDelta,
  contentDeltaOf,
  receiveDelta,
  recordContentUpdateAsDelta,
} from '../src/modules/blocks/ot-service.js';
import { AppError } from '../src/lib/errors.js';

const BLOCK = '018f0000-0000-7000-8000-0000000000b1';
const PAGE = '018f0000-0000-7000-8000-000000000001';
const USER = '018f0000-0000-7000-8000-0000000000u1';

const core = (rt: RichText) => rt as unknown as Parameters<typeof applyDelta>[0];
const coreDelta = (d: OtDelta) => d as unknown as Parameters<typeof applyDelta>[1];
const text = (rt: RichText): string =>
  rt.map((n) => ((n as { text?: string }).text ?? '￼')).join('');

/** 只認得 receiveDelta 會用到的那幾句 SQL 的記憶體資料庫。 */
class FakeTx implements Tx {
  content: RichText;
  rev = 0;
  readonly deltas: Array<{ rev: number; delta: OtDelta }> = [];
  readonly statements: string[] = [];

  constructor(initial: RichText) {
    this.content = initial;
  }

  /** receiveDelta 不會碰 raw client，測試裡用不到 */
  readonly client = null as unknown as Tx['client'];

  async query<T = Record<string, unknown>>(statement: Sql): Promise<T[]> {
    const sqlText = statement.text.replace(/\s+/g, ' ').trim();
    this.statements.push(sqlText);

    if (sqlText.startsWith('SELECT id, page_id, content, rev, version')) {
      return [
        {
          id: BLOCK,
          page_id: PAGE,
          content: this.content,
          rev: this.rev,
          version: this.rev + 1,
        },
      ] as T[];
    }
    if (sqlText.startsWith('SELECT rev, delta FROM block_deltas')) {
      const baseRev = statement.values[1] as number;
      return this.deltas.filter((d) => d.rev > baseRev) as T[];
    }
    if (sqlText.startsWith('INSERT INTO block_deltas')) {
      const rev = statement.values[1] as number;
      const delta = JSON.parse(statement.values[2] as string) as OtDelta;
      if (!this.deltas.some((d) => d.rev === rev)) this.deltas.push({ rev, delta });
      return [] as T[];
    }
    if (sqlText.startsWith('UPDATE blocks SET content =')) {
      this.content = JSON.parse(statement.values[0] as string) as RichText;
      this.rev = statement.values[1] as number;
      return [] as T[];
    }
    if (sqlText.startsWith('UPDATE blocks SET rev =')) {
      this.rev = statement.values[0] as number;
      return [] as T[];
    }
    throw new Error(`FakeTx 不認得這句 SQL：${sqlText}`);
  }

  async queryOne<T = Record<string, unknown>>(statement: Sql): Promise<T | null> {
    const rows = await this.query<T>(statement);
    return rows[0] ?? null;
  }
}

const send = (tx: FakeTx, delta: OtDelta, baseRev: number) =>
  receiveDelta(tx, { blockId: BLOCK, pageId: PAGE, delta, baseRev, actorId: USER });

describe('assertValidDelta', () => {
  it('接受合法的 delta', () => {
    expect(assertValidDelta({ ops: [{ retain: 2 }, { insert: 'x' }, { delete: 1 }] }, 10)).toBeTruthy();
  });

  it('拒絕不是 retain/insert/delete 的 op', () => {
    expect(() => assertValidDelta({ ops: [{ nope: 1 }] }, 10)).toThrow(AppError);
  });

  it('拒絕負數與非整數', () => {
    expect(() => assertValidDelta({ ops: [{ retain: -1 }] }, 10)).toThrow(AppError);
    expect(() => assertValidDelta({ ops: [{ delete: 1.5 }] }, 10)).toThrow(AppError);
  });

  it('拒絕 retain + delete 超過文件長度（baseRev 過舊）', () => {
    expect(() => assertValidDelta({ ops: [{ retain: 20 }] }, 3)).toThrow(/長度超過/);
  });

  it('拒絕不是物件的 delta', () => {
    expect(() => assertValidDelta(null, 10)).toThrow(AppError);
    expect(() => assertValidDelta({ ops: 'x' }, 10)).toThrow(AppError);
  });
});

describe('receiveDelta', () => {
  let tx: FakeTx;

  beforeEach(() => {
    tx = new FakeTx([{ text: 'hello' }]);
  });

  it('baseRev 等於目前 rev → 直接套用，rev + 1', async () => {
    const result = await send(tx, { ops: [{ retain: 5 }, { insert: ' world' }] }, 0);
    expect(result.rev).toBe(1);
    expect(result.changed).toBe(true);
    expect(text(result.content)).toBe('hello world');
    expect(tx.rev).toBe(1);
    expect(tx.deltas).toHaveLength(1);
  });

  it('SELECT ... FOR UPDATE 一定有下（序列化的關鍵）', async () => {
    await send(tx, { ops: [{ insert: 'x' }] }, 0);
    expect(tx.statements[0]).toContain('FOR UPDATE');
  });

  it('baseRev 落後 → 對中間的 delta 做 transform 之後才套用', async () => {
    // A 先送：在句首插入 'A'
    await send(tx, { ops: [{ insert: 'A' }] }, 0);
    expect(text(tx.content)).toBe('Ahello');

    // B 基於 rev 0（還沒看到 A）在句尾插入 '!'
    const result = await send(tx, { ops: [{ retain: 5 }, { insert: '!' }] }, 0);
    expect(result.rev).toBe(2);
    // B 的 retain 被推後 1，兩人的字都在
    expect(text(result.content)).toBe('Ahello!');
    expect(result.transformed).toEqual({ ops: [{ retain: 6 }, { insert: '!' }] });
  });

  it('伺服器回傳的 transformed 與客戶端自己算的完全一致（收斂的前提）', async () => {
    const aDelta: OtDelta = { ops: [{ insert: 'A' }] };
    const bDelta: OtDelta = { ops: [{ retain: 5 }, { insert: '!' }] };
    await send(tx, aDelta, 0);
    const result = await send(tx, bDelta, 0);
    // 客戶端 B 收到 A 的廣播時會算 transform(b, a, false)
    const clientSide = transform(coreDelta(bDelta), coreDelta(aDelta), false);
    expect(result.transformed).toEqual(clientSide);
  });

  it('三個人同時編輯：伺服器把每一筆都推進到最新版本', async () => {
    await send(tx, { ops: [{ insert: '1' }] }, 0);
    await send(tx, { ops: [{ insert: '2' }] }, 0);
    const third = await send(tx, { ops: [{ insert: '3' }] }, 0);
    expect(third.rev).toBe(3);
    // 後到的插入排在先到的後面（priority = false：已套用的優先）
    expect(text(tx.content)).toBe('123hello');
  });

  it('被別人刪光的那一段 → delta 變成 no-op，不推進 rev', async () => {
    await send(tx, { ops: [{ delete: 5 }] }, 0); // A 把整段刪光
    const result = await send(tx, { ops: [{ retain: 2, marks: { add: [{ t: 'b' }] } }] }, 0);
    expect(result.changed).toBe(false);
    expect(result.rev).toBe(1);
    expect(tx.deltas).toHaveLength(1);
  });

  it('baseRev 比目前 rev 大（不可能發生）→ 夾回目前 rev，不會炸', async () => {
    const result = await send(tx, { ops: [{ insert: 'x' }] }, 99);
    expect(result.rev).toBe(1);
  });

  it('block 不存在 → BLOCK_NOT_FOUND', async () => {
    const empty = new FakeTx([]);
    empty.query = async () => [];
    await expect(send(empty, { ops: [{ insert: 'x' }] }, 0)).rejects.toThrow(AppError);
  });

  it('窗口被清掉（baseRev 太舊）→ CONFLICT，請 client 重抓', async () => {
    await send(tx, { ops: [{ insert: 'A' }] }, 0);
    tx.deltas.length = 0; // 模擬保留期清理
    await expect(send(tx, { ops: [{ insert: 'B' }] }, 0)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('連續 20 筆併發 delta 都基於 rev 0 → 最後內容與逐一 transform 的結果一致', async () => {
    let mirror = core([{ text: 'hello' }]);
    const applied: OtDelta[] = [];
    for (let i = 0; i < 20; i += 1) {
      const d: OtDelta = { ops: [{ retain: Math.min(i, 5) }, { insert: String(i % 10) }] };
      const result = await send(tx, d, 0);
      // 自己在本地重跑一次伺服器的演算法，兩邊必須一致
      let t = coreDelta(d);
      for (const c of applied) t = transform(t, coreDelta(c), false);
      mirror = applyDelta(mirror, t);
      applied.push(result.transformed);
      expect(text(result.content)).toBe(text(mirror as unknown as RichText));
    }
    expect(tx.rev).toBe(20);
  });
});

describe('recordContentUpdateAsDelta（兩條通道共用一條 rev 線）', () => {
  it('block.update{content} 會被記成一筆 delta 並推進 rev', async () => {
    const tx = new FakeTx([{ text: 'hello' }]);
    const rev = await recordContentUpdateAsDelta(tx, {
      blockId: BLOCK,
      before: [{ text: 'hello' }],
      after: [{ text: 'hello!' }],
      actorId: USER,
    });
    expect(rev).toBe(1);
    expect(tx.rev).toBe(1);
    expect(tx.deltas[0]!.delta).toEqual({ ops: [{ retain: 5 }, { insert: '!' }] });
  });

  it('內容沒變 → 不寫 delta、不推進 rev', async () => {
    const tx = new FakeTx([{ text: 'hello' }]);
    const rev = await recordContentUpdateAsDelta(tx, {
      blockId: BLOCK,
      before: [{ text: 'hello' }],
      after: [{ text: 'hello' }],
      actorId: USER,
    });
    expect(rev).toBeNull();
    expect(tx.rev).toBe(0);
  });

  it('整段覆蓋之後，舊 baseRev 的 delta 仍然會被 transform 到正確位置', async () => {
    const tx = new FakeTx([{ text: 'hello' }]);
    // 有人用 tx 通道把內容換成 'Xhello'
    await recordContentUpdateAsDelta(tx, {
      blockId: BLOCK,
      before: [{ text: 'hello' }],
      after: [{ text: 'Xhello' }],
      actorId: USER,
    });
    tx.content = [{ text: 'Xhello' }];
    // 另一個人基於 rev 0 在句尾打字
    const result = await send(tx, { ops: [{ retain: 5 }, { insert: '!' }] }, 0);
    expect(text(result.content)).toBe('Xhello!');
  });
});

/**
 * BUG-4（`docs/qa/functional-round1.md`）的伺服器側：
 * `block.update{content}` 與「baseRev 比它舊的 delta」交錯時會發生什麼事。
 *
 * 結論：伺服器這一層是**對的** —— 它照 OT 的規矩把舊 delta transform 到最新版本。
 * 壞掉的是客戶端：那一筆 delta 在語意上早就被整段覆寫取代了，根本不該送出來。
 * 這裡把兩種順序都測出來，修法（ADR 0006 §2.9）才有可比對的基準。
 */
describe('BUG-4：block.update{content} 與舊 baseRev delta 交錯', () => {
  /** 複刻 apply-transaction.ts 的 block.update{content} 分支 */
  async function contentUpdate(tx: FakeTx, after: RichText): Promise<number | null> {
    const before = tx.content;
    const rev = await recordContentUpdateAsDelta(tx, { blockId: BLOCK, before, after, actorId: USER });
    tx.content = after;
    return rev;
  }

  it('舊送法：整段覆寫之後才到的 stale delta 會把前綴留在伺服器上', async () => {
    const tx = new FakeTx([]);
    // 1) 打 '>'
    await send(tx, { ops: [{ insert: '>' }] }, 0);
    expect(text(tx.content)).toBe('>');
    expect(tx.rev).toBe(1);

    // 2) markdown 規則：block.update{blockType:'quote', content: []} 走 tx 通道
    expect(await contentUpdate(tx, [])).toBe(2);
    expect(text(tx.content)).toBe('');

    // 3) 「打空白鍵」那一筆 delta 現在才被 OT buffer 沖出來（baseRev 1，已經過時）
    const stale = await send(tx, { ops: [{ retain: 1 }, { insert: ' ' }] }, 1);
    // 伺服器正確地 transform 了它，但它本來就不該存在 → 伺服器留下一個多餘的字
    expect(text(stale.content)).toBe(' ');
    expect(text(tx.content)).not.toBe('');
  });

  it('新送法：整段覆寫也走 delta 通道（compose 進 buffer）→ 伺服器內容 = 使用者所見', async () => {
    const tx = new FakeTx([]);
    // 1) 打 '>'
    await send(tx, { ops: [{ insert: '>' }] }, 0);
    // 2) 空白鍵的 delta 與 markdown 捷徑的整段覆寫在客戶端被 compose 成 `delete 1`
    await send(tx, { ops: [{ delete: 1 }] }, 1);
    expect(text(tx.content)).toBe('');
    expect(tx.rev).toBe(2);
    // 3) 接著打內文
    await send(tx, { ops: [{ insert: 'quote' }] }, 2);
    expect(text(tx.content)).toBe('quote');
  });

  it('別人的整段覆寫與我基於舊 rev 的 delta 交錯，仍然收斂（不會掉字）', async () => {
    const tx = new FakeTx([{ text: 'hello' }]);
    // 我基於 rev 0 在句尾打 '!'（還沒送到）
    const mine: OtDelta = { ops: [{ retain: 5 }, { insert: '!' }] };
    // 對方先用 tx 通道把內容整段換成 'HELLO'
    expect(await contentUpdate(tx, [{ text: 'HELLO' }])).toBe(1);
    // 我的 delta 現在才到（baseRev 0）→ 伺服器對 rev 1 的 delta 做 transform
    const result = await send(tx, mine, 0);
    expect(text(result.content)).toBe('HELLO!');
    expect(tx.rev).toBe(2);
  });

  it('block.update{content} 廣播出去的 delta 套回舊內容 = 新內容（contentDeltaOf）', () => {
    const before: RichText = [{ text: 'hello' }];
    const after: RichText = [{ text: 'HELLO world' }];
    const delta = contentDeltaOf(before, after);
    expect(text(applyDelta(core(before), coreDelta(delta)) as unknown as RichText)).toBe('HELLO world');
  });

  it('整段覆寫沒有推進 rev（no-op）時，後續 delta 的 baseRev 不會錯位', async () => {
    const tx = new FakeTx([{ text: 'hello' }]);
    expect(await contentUpdate(tx, [{ text: 'hello' }])).toBeNull();
    expect(tx.rev).toBe(0);
    const result = await send(tx, { ops: [{ retain: 5 }, { insert: '!' }] }, 0);
    expect(text(result.content)).toBe('hello!');
    expect(result.rev).toBe(1);
  });
});

describe('FEATURE_OT 開關', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('預設（FEATURE_OT=false）：text.delta 仍然回 NOT_IMPLEMENTED', async () => {
    vi.stubEnv('FEATURE_OT', 'false');
    const { parseTransaction } = await import('../src/modules/blocks/validate-ops.js');
    expect(() =>
      parseTransaction(
        {
          txId: '018f0000-0000-7000-8000-0000000000aa',
          pageId: PAGE,
          originSessionId: 's',
          ops: [{ type: 'text.delta', blockId: BLOCK, delta: { ops: [{ insert: 'x' }] }, baseRev: 0 }],
        },
        PAGE,
      ),
    ).toThrow(/FEATURE_OT/);
  });

  it('FEATURE_OT=true：text.delta 通過驗證', async () => {
    vi.stubEnv('FEATURE_OT', 'true');
    const { parseTransaction } = await import('../src/modules/blocks/validate-ops.js');
    const result = parseTransaction(
      {
        txId: '018f0000-0000-7000-8000-0000000000aa',
        pageId: PAGE,
        originSessionId: 's',
        ops: [{ type: 'text.delta', blockId: BLOCK, delta: { ops: [{ insert: 'x' }] }, baseRev: 0 }],
      },
      PAGE,
    );
    expect(result.ops[0]!.type).toBe('text.delta');
  });
});
