/**
 * 匿名訪客的頁面快照（公開分享連結）。
 * 與 pages/service.getSnapshot 同一個形狀（03 §9.1 record_map），
 * 但**不做工作區成員檢查**，改由 resolvePublicAccess 先驗過 token / 密碼 / 到期。
 * role 一律 'reader'，前端據此關掉所有編輯 UI。
 */
import type { PageSnapshot, PublicUser } from '@kennote/shared-types';
import { db } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { pageNotFound } from '../../lib/errors.js';
import { listBlocksByPage, toBlock } from '../blocks/repo.js';
import { PAGE_COLUMNS, toPage, type PageRow } from '../pages/repo.js';

export async function getPublicSnapshot(pageId: string): Promise<PageSnapshot> {
  const row = await db.queryOne<PageRow>(sql`
    SELECT ${PAGE_COLUMNS} FROM pages WHERE id = ${pageId} AND deleted_at IS NULL
  `);
  if (!row) throw pageNotFound();

  const page = toPage(row);
  const blocks = (await listBlocksByPage(pageId)).map(toBlock);
  const role = 'reader' as const;

  return {
    pageId,
    seq: page.seq,
    rootBlockIds: page.children,
    recordMap: {
      page: { [page.id]: { value: page, role } },
      block: Object.fromEntries(blocks.map((b) => [b.id, { value: b, role }])),
      // 匿名訪客不該拿到工作區成員的 email；使用者 map 留空
      user: {} as Record<string, { value: PublicUser; role: typeof role }>,
    },
  };
}
