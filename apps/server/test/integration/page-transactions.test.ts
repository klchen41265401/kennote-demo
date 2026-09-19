/**
 * 整合測試：頁面建立 → transaction 套用 → snapshot。
 * 需要真的 PostgreSQL（DATABASE_URL_TEST）；沒有就整組 skip。
 *
 * 跑法：
 *   DATABASE_URL_TEST=postgres://kennote:kennote@localhost:5432/kennote_test \
 *   pnpm --filter @kennote/server migrate && pnpm --filter @kennote/server test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);

describe.skipIf(!HAS_DB)('applyTransaction 整合測試', () => {
  let closePool: () => Promise<void>;
  let applyTransaction: typeof import('../../src/modules/blocks/apply-transaction.js').applyTransaction;
  let uuidv7: typeof import('../../src/lib/uuidv7.js').uuidv7;
  let userId = '';
  let workspaceId = '';
  let pageId = '';

  beforeAll(async () => {
    await import('../../src/modules/blocks/block-types/index.js');
    const client = await import('../../src/db/client.js');
    const { sql } = await import('../../src/db/sql.js');
    const authRepo = await import('../../src/modules/auth/repo.js');
    const wsRepo = await import('../../src/modules/workspaces/repo.js');
    const pageService = await import('../../src/modules/pages/service.js');
    ({ closePool } = client);
    ({ applyTransaction } = await import('../../src/modules/blocks/apply-transaction.js'));
    ({ uuidv7 } = await import('../../src/lib/uuidv7.js'));

    const email = `test-${Date.now()}@kennote.test`;
    const created = await client.withTransaction(async (tx) => {
      const user = await authRepo.createUserWithLocalIdentity(tx, {
        email,
        name: '測試使用者',
        passwordHash: 'x',
      });
      const ws = await wsRepo.createWorkspace(tx, {
        name: '測試工作區',
        slug: `test-${Date.now()}`,
        ownerId: user.id,
      });
      return { userId: user.id, workspaceId: ws.id };
    });
    userId = created.userId;
    workspaceId = created.workspaceId;

    const page = await pageService.createPage(
      { workspaceId, title: [{ text: '測試頁' }] },
      userId,
    );
    pageId = page.id;
    void sql;
  });

  afterAll(async () => {
    if (closePool) await closePool();
  });

  it('建立頁面時自動產生一個空 paragraph', async () => {
    const { getSnapshot } = await import('../../src/modules/pages/service.js');
    const snapshot = await getSnapshot(pageId, userId);
    expect(snapshot.rootBlockIds).toHaveLength(1);
    const blockId = snapshot.rootBlockIds[0]!;
    expect(snapshot.recordMap.block[blockId]!.value.type).toBe('paragraph');
    expect(snapshot.seq).toBe(1);
  });

  it('同一個 txId 重送不會重複套用（冪等）', async () => {
    const txId = uuidv7();
    const blockId = uuidv7();
    const op = {
      txId,
      pageId,
      originSessionId: 'test',
      ops: [
        {
          type: 'block.insert',
          blockId,
          parentId: null,
          afterId: null,
          blockType: 'paragraph',
          props: {},
          content: [{ text: 'hello' }],
        },
      ],
    };
    const first = await applyTransaction({ pageId, userId }, op);
    const second = await applyTransaction({ pageId, userId }, op);
    expect(second.seq).toBe(first.seq);

    const { getSnapshot } = await import('../../src/modules/pages/service.js');
    const snapshot = await getSnapshot(pageId, userId);
    expect(snapshot.rootBlockIds.filter((id) => id === blockId)).toHaveLength(1);
  });

  it('不合法的 operation → 整批不套用（原子性）', async () => {
    const { getSnapshot } = await import('../../src/modules/pages/service.js');
    const before = await getSnapshot(pageId, userId);
    await expect(
      applyTransaction(
        { pageId, userId },
        {
          txId: uuidv7(),
          pageId,
          originSessionId: 'test',
          ops: [
            {
              type: 'block.insert',
              blockId: uuidv7(),
              parentId: null,
              afterId: null,
              blockType: 'paragraph',
              props: {},
              content: [{ text: 'ok' }],
            },
            { type: 'block.delete', blockId: uuidv7() === '' ? '' : 'not-a-uuid' },
          ],
        },
      ),
    ).rejects.toThrow();
    const after = await getSnapshot(pageId, userId);
    expect(after.rootBlockIds).toEqual(before.rootBlockIds);
    expect(after.seq).toBe(before.seq);
  });

  it('別人的 workspace 頁面 → 404（不洩漏存在性）', async () => {
    const { getSnapshot } = await import('../../src/modules/pages/service.js');
    const otherUser = uuidv7();
    await expect(getSnapshot(pageId, otherUser)).rejects.toMatchObject({
      code: 'PAGE_NOT_FOUND',
      statusCode: 404,
    });
    expect(workspaceId).toBeTruthy();
  });
});
