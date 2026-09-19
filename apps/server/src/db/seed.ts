/**
 * 開發用種子資料：demo@kennote.local / demo1234
 * 用法：pnpm --filter @kennote/server seed（要先跑過 migrate）
 *
 * 刻意用 service 層而不是直接寫 SQL —— 這樣 seed 也順便驗證了
 * 「建立頁面會自動產生一個空 paragraph」這條路徑真的能跑。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, db, withTransaction } from './client.js';
import { sql } from './sql.js';
import { uuidv7 } from '../lib/uuidv7.js';
import { applyTransaction } from '../modules/blocks/apply-transaction.js';
import { createUserWithLocalIdentity, findUserByEmail } from '../modules/auth/repo.js';
import { hashPassword } from '../modules/auth/password.js';
import { createPage } from '../modules/pages/service.js';
import { createWorkspace, listWorkspacesForUser } from '../modules/workspaces/repo.js';

// registry 必須先註冊
import '../modules/blocks/block-types/index.js';
import '../modules/databases/field-types/index.js';

const DEMO_EMAIL = 'demo@kennote.local';
const DEMO_PASSWORD = 'demo1234';

export async function seed(): Promise<void> {
  const existing = await findUserByEmail(DEMO_EMAIL);
  if (existing) {
    console.log(`ℹ️  ${DEMO_EMAIL} 已存在，略過建立使用者`);
    const workspaces = await listWorkspacesForUser(existing.id);
    console.log(`   目前有 ${workspaces.length} 個工作區`);
    return;
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const { userId, workspaceId } = await withTransaction(async (tx) => {
    const user = await createUserWithLocalIdentity(tx, {
      email: DEMO_EMAIL,
      name: 'Demo 使用者',
      passwordHash,
    });
    const ws = await createWorkspace(tx, {
      name: 'Demo 工作區',
      slug: 'demo',
      ownerId: user.id,
    });
    return { userId: user.id, workspaceId: ws.id };
  });

  const page = await createPage(
    {
      workspaceId,
      title: [{ text: 'kennote 使用說明' }],
      icon: '📘',
    },
    userId,
  );

  // 用正規的 transaction 管線塞入範例內容（所有 block 變更只有這一條路）
  const ids = Array.from({ length: 6 }, () => uuidv7());
  await applyTransaction(
    { pageId: page.id, userId },
    {
      txId: uuidv7(),
      pageId: page.id,
      originSessionId: 'seed',
      ops: [
        {
          type: 'block.insert',
          blockId: ids[0],
          parentId: null,
          afterId: page.children[0] ?? null,
          blockType: 'heading2',
          props: {},
          content: [{ text: '這是什麼' }],
        },
        {
          type: 'block.insert',
          blockId: ids[1],
          parentId: null,
          afterId: ids[0],
          blockType: 'paragraph',
          props: {},
          content: [
            { text: 'kennote 是一套' },
            { text: '全自研', marks: [{ t: 'b' }] },
            { text: '的 Notion 類知識庫。編輯器、同步引擎、搜尋、資料庫引擎全部自己寫。' },
          ],
        },
        {
          type: 'block.insert',
          blockId: ids[2],
          parentId: null,
          afterId: ids[1],
          blockType: 'callout',
          props: { icon: '💡', color: 'blue_background' },
          content: [{ text: '這一頁的所有內容都是透過 POST /api/pages/:id/transactions 建立的。' }],
        },
        {
          type: 'block.insert',
          blockId: ids[3],
          parentId: null,
          afterId: ids[2],
          blockType: 'heading3',
          props: {},
          content: [{ text: '下一步' }],
        },
        {
          type: 'block.insert',
          blockId: ids[4],
          parentId: null,
          afterId: ids[3],
          blockType: 'todo',
          props: { checked: true },
          content: [{ text: 'M1：骨架、認證、頁面 CRUD' }],
        },
        {
          type: 'block.insert',
          blockId: ids[5],
          parentId: null,
          afterId: ids[4],
          blockType: 'todo',
          props: { checked: false },
          content: [{ text: 'M2-A：自研 block 編輯器核心引擎' }],
        },
      ],
    },
  );

  await createPage(
    { workspaceId, title: [{ text: '會議筆記' }], icon: '🗒️' },
    userId,
  );

  const counts = await db.queryOne<{ pages: number; blocks: number }>(sql`
    SELECT (SELECT count(*)::int FROM pages WHERE workspace_id = ${workspaceId}) AS pages,
           (SELECT count(*)::int FROM blocks WHERE workspace_id = ${workspaceId}) AS blocks
  `);

  console.log('✅ 種子資料建立完成');
  console.log(`   帳號：${DEMO_EMAIL}`);
  console.log(`   密碼：${DEMO_PASSWORD}`);
  console.log(`   工作區：${workspaceId}（${counts?.pages ?? 0} 頁 / ${counts?.blocks ?? 0} 個 block）`);
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntry) {
  seed()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('❌ 種子資料建立失敗：', err);
      await closePool().catch(() => {});
      process.exit(1);
    });
}
