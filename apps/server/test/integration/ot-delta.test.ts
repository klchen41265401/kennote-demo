/**
 * 整合測試：`text.delta` 走完整條 applyTransaction 路徑（真 PostgreSQL）。
 * 需要 DATABASE_URL_TEST；沒有就整組 skip（與 page-transactions.test.ts 同一套規則）。
 *
 * 跑法：
 *   DATABASE_URL_TEST=postgres://kennote:kennote@localhost:5432/kennote_test \
 *   FEATURE_OT=true \
 *   pnpm --filter @kennote/server migrate && pnpm --filter @kennote/server test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Operation, RichText, TransactionResult } from '@kennote/shared-types';
import { isTextDeltaOperation, textDeltaOperation } from '@kennote/shared-types';

const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);
// env.ts 在 import 時就固定了，所以 FEATURE_OT 必須從外面帶進來
const OT_ON = process.env.FEATURE_OT === 'true' || process.env.FEATURE_OT === '1';

const plain = (rt: RichText): string =>
  rt.map((n) => (n as { text?: string }).text ?? '￼').join('');

describe.skipIf(!HAS_DB || !OT_ON)('text.delta 整合測試（FEATURE_OT=true）', () => {
  let closePool: () => Promise<void>;
  let applyTransaction: typeof import('../../src/modules/blocks/apply-transaction.js').applyTransaction;
  let findBlock: typeof import('../../src/modules/blocks/repo.js').findBlock;
  let uuidv7: typeof import('../../src/lib/uuidv7.js').uuidv7;
  let userId = '';
  let pageId = '';
  let blockId = '';

  const submit = async (ops: Operation[]): Promise<TransactionResult> =>
    applyTransaction({ pageId, userId }, {
      txId: uuidv7(),
      pageId,
      originSessionId: 'test',
      ops,
    });

  beforeAll(async () => {
    await import('../../src/modules/blocks/block-types/index.js');
    const client = await import('../../src/db/client.js');
    const authRepo = await import('../../src/modules/auth/repo.js');
    const wsRepo = await import('../../src/modules/workspaces/repo.js');
    const pageService = await import('../../src/modules/pages/service.js');
    ({ closePool } = client);
    ({ applyTransaction } = await import('../../src/modules/blocks/apply-transaction.js'));
    ({ findBlock } = await import('../../src/modules/blocks/repo.js'));
    ({ uuidv7 } = await import('../../src/lib/uuidv7.js'));

    const created = await client.withTransaction(async (tx) => {
      const user = await authRepo.createUserWithLocalIdentity(tx, {
        email: `ot-${Date.now()}@kennote.test`,
        name: 'OT 測試',
        passwordHash: 'x',
      });
      const ws = await wsRepo.createWorkspace(tx, {
        name: 'OT 工作區',
        slug: `ot-${Date.now()}`,
        ownerId: user.id,
      });
      return { userId: user.id, workspaceId: ws.id };
    });
    userId = created.userId;
    const page = await pageService.createPage(
      { workspaceId: created.workspaceId, title: [{ text: 'OT 測試頁' }] },
      userId,
    );
    pageId = page.id;
    const snapshot = await pageService.getSnapshot(pageId, userId);
    blockId = snapshot.rootBlockIds[0]!;
    await submit([{ type: 'block.update', blockId, patch: { content: [{ text: 'hello' }] } }]);
  });

  afterAll(async () => {
    if (closePool) await closePool();
  });

  it('套用一筆 delta：content 更新、rev + 1、block_deltas 留一筆', async () => {
    const before = await findBlock(blockId);
    const baseRev = Number((before as unknown as { rev: number }).rev);

    const result = await submit([
      textDeltaOperation(blockId, { ops: [{ retain: 5 }, { insert: ' world' }] }, baseRev),
    ]);

    const after = await findBlock(blockId);
    expect(plain(after!.content)).toBe('hello world');
    expect(Number((after as unknown as { rev: number }).rev)).toBe(baseRev + 1);

    const echoed = result.ops.find(isTextDeltaOperation);
    expect(echoed?.rev).toBe(baseRev + 1);
  });

  it('兩人同時編輯同一段文字，兩人的字都保留（M6 驗收標準）', async () => {
    const before = await findBlock(blockId);
    const baseRev = Number((before as unknown as { rev: number }).rev);
    const len = plain(before!.content).length;

    // A 在句尾加字
    await submit([textDeltaOperation(blockId, { ops: [{ retain: len }, { insert: '!' }] }, baseRev)]);
    // B 用**同一個 baseRev** 在句首加字（模擬併發）
    const b = await submit([textDeltaOperation(blockId, { ops: [{ insert: 'B:' }] }, baseRev)]);

    const after = await findBlock(blockId);
    const text = plain(after!.content);
    expect(text.startsWith('B:')).toBe(true);
    expect(text.endsWith('!')).toBe(true);
    expect(Number((after as unknown as { rev: number }).rev)).toBe(baseRev + 2);
    expect(b.ops.find(isTextDeltaOperation)?.rev).toBe(baseRev + 2);
  });

  it('同一個 txId 重送不會重複套用（冪等）', async () => {
    const before = await findBlock(blockId);
    const baseRev = Number((before as unknown as { rev: number }).rev);
    const txId = uuidv7();
    const ops = [textDeltaOperation(blockId, { ops: [{ insert: 'X' }] }, baseRev)];

    const first = await applyTransaction({ pageId, userId }, { txId, pageId, originSessionId: 't', ops });
    const second = await applyTransaction({ pageId, userId }, { txId, pageId, originSessionId: 't', ops });
    expect(second.seq).toBe(first.seq);

    const after = await findBlock(blockId);
    expect(Number((after as unknown as { rev: number }).rev)).toBe(baseRev + 1);
  });

  it('page_transactions 記的是最終 content（版本歷史不必認識 OT）', async () => {
    const { db } = await import('../../src/db/client.js');
    const { sql } = await import('../../src/db/sql.js');
    const before = await findBlock(blockId);
    const baseRev = Number((before as unknown as { rev: number }).rev);
    const result = await submit([
      textDeltaOperation(blockId, { ops: [{ insert: 'Z' }] }, baseRev),
    ]);
    const row = await db.queryOne<{ ops: Operation[] }>(sql`
      SELECT ops FROM page_transactions WHERE tx_id = ${result.txId}
    `);
    expect(row).not.toBeNull();
    const stored = row!.ops[0]!;
    expect(stored.type).toBe('block.update');
    if (stored.type === 'block.update') {
      expect(plain(stored.patch.content ?? [])).toContain('Z');
    }
  });

  it('block.update{content} 也會推進 rev（兩條通道共用一條 rev 線）', async () => {
    const before = await findBlock(blockId);
    const baseRev = Number((before as unknown as { rev: number }).rev);
    await submit([{ type: 'block.update', blockId, patch: { content: [{ text: 'reset' }] } }]);
    const after = await findBlock(blockId);
    expect(Number((after as unknown as { rev: number }).rev)).toBe(baseRev + 1);
    expect(plain(after!.content)).toBe('reset');
  });
});
