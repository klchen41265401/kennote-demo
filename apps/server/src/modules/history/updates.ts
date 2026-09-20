/**
 * 「更新」feed（gap-review B-5 / 舊帳 O-38）。
 *
 * Notion 7.34 的右側面板是「更新和分析」兩個 tab，裡面的「更新」是**活動摘要**
 * （誰、什麼時候、改了什麼 / 留了什麼言），跟「版本紀錄」（⋯ 選單裡另一個獨立項目，
 * 快照清單 + 還原）是兩個不同的東西。
 * 依據：`reference/shots/gap-review/notion/_SUMMARY.json` 的 `A_rightPanel`
 * 與 `_A3-updates.json`（role=tab「更新」/「分析」、每則更新右側有
 * aria-label「查看本次更新後的版本」的 24×24 按鈕）。
 *
 * 這個模組刻意拆成兩層：
 *   - `buildUpdates()`：**純函式**，只吃已經撈好的 row，好寫單元測試
 *   - `listUpdates()` ：查 DB + 權限 + 補 user 資料
 */
import type {
  Operation,
  PageUpdateEntry,
  PageUpdatesResponse,
  PublicUser,
} from '@kennote/shared-types';
import { UPDATES_GROUP_MS, UPDATES_PAGE_SIZE } from '@kennote/shared-types';
import { db } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { listUsersByIds } from '../permissions/repo.js';
import { requirePagePermission } from '../permissions/service.js';

export interface UpdateTxRow {
  seq: number;
  ops: Operation[];
  applied_at: Date | string;
  actor_id: string | null;
}

export interface UpdateCommentRow {
  id: string;
  discussion_id: string;
  author_id: string | null;
  plain_text: string;
  created_at: Date | string;
}

export interface UpdateResolveRow {
  id: string;
  resolved_by: string | null;
  resolved_at: Date | string;
}

const iso = (v: Date | string): string => (typeof v === 'string' ? v : v.toISOString());

const PROPERTY_LABEL: Record<string, string> = {
  title: '標題',
  icon: '圖示',
  cover: '封面',
};

function snippetOf(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 140 ? `${one.slice(0, 140)}…` : one;
}

/**
 * 一筆 transaction → 0~2 則 entry。
 *
 * `text.delta`（M6 OT 的細粒度文字操作）也算「編輯了這個區塊」；
 * `page.update` 另外拆成一則 `property`，因為 Notion 的更新 feed
 * 把「改標題 / 換圖示」跟「編輯內文」分開講。
 */
function entriesOfTx(row: UpdateTxRow): PageUpdateEntry[] {
  const at = iso(row.applied_at);
  const seq = Number(row.seq);
  const blockIds = new Set<string>();
  const properties = new Set<string>();

  for (const op of row.ops ?? []) {
    switch (op.type) {
      case 'block.insert':
      case 'block.update':
      case 'block.move':
      case 'block.delete':
      case 'text.delta':
        blockIds.add(op.blockId);
        break;
      case 'page.update':
        for (const key of Object.keys(op.patch ?? {})) properties.add(key);
        break;
      default:
        break;
    }
  }

  const out: PageUpdateEntry[] = [];
  if (blockIds.size > 0) {
    out.push({
      id: `edit:${seq}`,
      kind: 'edit',
      seq,
      actorId: row.actor_id,
      at,
      summary: `編輯了 ${blockIds.size} 個區塊`,
      blockIds: [...blockIds].slice(0, 20),
      discussionId: null,
      snippet: null,
      properties: [],
    });
  }
  if (properties.size > 0) {
    const labels = [...properties].map((k) => PROPERTY_LABEL[k] ?? k);
    out.push({
      id: `property:${seq}`,
      kind: 'property',
      seq,
      actorId: row.actor_id,
      at,
      summary: `變更了${labels.join('、')}`,
      blockIds: [],
      discussionId: null,
      snippet: null,
      properties: [...properties],
    });
  }
  return out;
}

/**
 * 合併「同一個人、同一種類、5 分鐘內」的相鄰 entry。
 *
 * 不合併的話，打一段字會產生十幾筆 tx（debounce 之後仍然是多筆），
 * feed 會變成一整面的「編輯了 1 個區塊」。合併之後取**最新**那一筆的
 * seq / 時間（「查看本次更新後的版本」要跳到該段編輯的結果）。
 */
export function groupUpdates(entries: readonly PageUpdateEntry[]): PageUpdateEntry[] {
  const out: PageUpdateEntry[] = [];
  for (const entry of entries) {
    const prev = out[out.length - 1];
    const mergeable =
      prev !== undefined &&
      prev.kind === entry.kind &&
      (prev.kind === 'edit' || prev.kind === 'property') &&
      prev.actorId === entry.actorId &&
      Math.abs(Date.parse(prev.at) - Date.parse(entry.at)) <= UPDATES_GROUP_MS;
    if (!mergeable || prev === undefined) {
      out.push({ ...entry, blockIds: [...entry.blockIds], properties: [...entry.properties] });
      continue;
    }
    // entries 是新→舊，prev 比 entry 新：保留 prev 的 seq / at，併入 entry 的範圍
    const blockIds = [...new Set([...prev.blockIds, ...entry.blockIds])].slice(0, 20);
    const properties = [...new Set([...prev.properties, ...entry.properties])];
    out[out.length - 1] = {
      ...prev,
      blockIds,
      properties,
      summary:
        prev.kind === 'edit'
          ? `編輯了 ${blockIds.length} 個區塊`
          : `變更了${properties.map((k) => PROPERTY_LABEL[k] ?? k).join('、')}`,
    };
  }
  return out;
}

/**
 * 三種來源 → 一條依時間新→舊排序、已合併的 feed。純函式，方便單元測試。
 */
export function buildUpdates(input: {
  transactions: readonly UpdateTxRow[];
  comments: readonly UpdateCommentRow[];
  resolved: readonly UpdateResolveRow[];
  limit?: number;
}): PageUpdateEntry[] {
  const entries: PageUpdateEntry[] = [];

  for (const tx of input.transactions) entries.push(...entriesOfTx(tx));

  for (const c of input.comments) {
    entries.push({
      id: `comment:${c.id}`,
      kind: 'comment',
      seq: null,
      actorId: c.author_id,
      at: iso(c.created_at),
      summary: '留言',
      blockIds: [],
      discussionId: c.discussion_id,
      snippet: snippetOf(c.plain_text ?? ''),
      properties: [],
    });
  }

  for (const r of input.resolved) {
    entries.push({
      id: `resolved:${r.id}`,
      kind: 'comment_resolved',
      seq: null,
      actorId: r.resolved_by,
      at: iso(r.resolved_at),
      summary: '解決了一個討論串',
      blockIds: [],
      discussionId: r.id,
      snippet: null,
      properties: [],
    });
  }

  entries.sort((a, b) => {
    const diff = Date.parse(b.at) - Date.parse(a.at);
    if (diff !== 0) return diff;
    return (b.seq ?? 0) - (a.seq ?? 0);
  });

  return groupUpdates(entries).slice(0, input.limit ?? UPDATES_PAGE_SIZE);
}

/* ── 服務層 ─────────────────────────────────────────── */

export async function listUpdates(
  pageId: string,
  userId: string,
  cursor?: string | null,
): Promise<PageUpdatesResponse> {
  await requirePagePermission(userId, pageId, 'read');

  const before = cursor && !Number.isNaN(Date.parse(cursor)) ? new Date(cursor) : null;
  // 多撈一些原始 row：合併之後才知道夠不夠一頁
  const raw = UPDATES_PAGE_SIZE * 6;

  const txWhere = before ? sql` AND applied_at < ${before}` : sql.empty;
  const transactions = await db.query<UpdateTxRow>(sql`
    SELECT seq, ops, applied_at, actor_id
      FROM page_transactions
     WHERE page_id = ${pageId}${txWhere}
     ORDER BY applied_at DESC, seq DESC
     LIMIT ${raw}
  `);

  const cWhere = before ? sql` AND c.created_at < ${before}` : sql.empty;
  const comments = await db.query<UpdateCommentRow>(sql`
    SELECT c.id, c.discussion_id, c.author_id, c.plain_text, c.created_at
      FROM comments c
      JOIN discussions d ON d.id = c.discussion_id
     WHERE d.page_id = ${pageId} AND c.deleted_at IS NULL AND d.deleted_at IS NULL${cWhere}
     ORDER BY c.created_at DESC
     LIMIT ${raw}
  `);

  const rWhere = before ? sql` AND resolved_at < ${before}` : sql.empty;
  const resolved = await db.query<UpdateResolveRow>(sql`
    SELECT id, resolved_by, resolved_at
      FROM discussions
     WHERE page_id = ${pageId} AND resolved_at IS NOT NULL AND deleted_at IS NULL${rWhere}
     ORDER BY resolved_at DESC
     LIMIT ${raw}
  `);

  const entries = buildUpdates({ transactions, comments, resolved });
  const last = entries[entries.length - 1];
  const exhausted =
    transactions.length < raw && comments.length < raw && resolved.length < raw;
  const nextCursor = exhausted || !last || entries.length < UPDATES_PAGE_SIZE ? null : last.at;

  const ids = [...new Set(entries.map((e) => e.actorId).filter((v): v is string => Boolean(v)))];
  const users: Record<string, PublicUser> = {};
  for (const u of await listUsersByIds(ids)) {
    users[u.id] = { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatar_url };
  }

  return { pageId, entries, nextCursor, users };
}
