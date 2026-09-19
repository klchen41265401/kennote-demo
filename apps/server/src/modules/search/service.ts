/**
 * 搜尋服務（自建，不引入外部搜尋服務 —— 00-README 決策 #8、01 §8.1）。
 *
 * 兩條查詢路徑，共用同一套斷詞與同一組篩選條件：
 *   A. tsvector + GIN：`ts_rank_cd` 相關性排序、標題權重 A、時間衰減加權
 *   B. pg_trgm + ILIKE：查詢太短（1~2 字）或 A 沒結果時的 fallback
 *
 * ⭐ 資安紅線（01 §8 M7.1.5）：權限**必須在查詢層過濾**。
 *    第一層是 workspace_members 的 JOIN（寫在同一句 SQL 裡，不是先撈後濾）；
 *    第二層是頁面層授權，對候選集（≤ 60 筆）用 permissions/service 解析，
 *    而且只在「這個工作區真的有 page_permissions 條目」或「使用者是 guest」時才跑
 *    —— 沒有條目時 member 的 baseline 就是 edit，跑了也是白跑（03 §7.4 的效能陷阱）。
 */
import type {
  RecentPage,
  SearchHit,
  SearchResponse,
  SearchResultType,
  SearchTypeFilter,
} from '@kennote/shared-types';
import { db } from '../../db/client.js';
import { sql, type Sql } from '../../db/sql.js';
import { workspaceNotFound } from '../../lib/errors.js';
import { resolvePagePermission } from '../permissions/service.js';
import { getMemberRole } from '../workspaces/repo.js';
import { listRecentPages } from '../recent/service.js';
import { loadParentTitles } from './ancestors.js';
import { parseQuery } from './segment.js';
import {
  buildSnippet,
  headlineHasSentinel,
  sanitizeHeadline,
  TS_HEADLINE_OPTIONS,
} from './snippet.js';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
/** 每條查詢路徑先取這麼多候選，再合併 / 去重 / 權限過濾 */
const CANDIDATE_LIMIT = 200;

export interface SearchInput {
  q: string;
  workspaceId?: string | undefined;
  type?: SearchTypeFilter | undefined;
  createdBy?: string | undefined;
  updatedAfter?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

/* ── cursor ───────────────────────────────────────────────
 * 相關性排序的 keyset cursor 需要把 float 分數塞進游標，而分數會隨
 * 時間衰減改變 → 同一個 cursor 過幾分鐘就不穩定。搜尋不需要穩定深頁，
 * 所以這裡刻意用 offset cursor（仍然編碼成不透明字串，之後要換成
 * keyset 不必改前端）。
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown };
    const offset = Number(parsed.o);
    if (!Number.isFinite(offset) || offset < 0) return 0;
    return Math.min(Math.floor(offset), 1000);
  } catch {
    return 0;
  }
}

/* ── 篩選條件（兩條查詢路徑共用） ─────────────────────── */

function pageFilters(input: SearchInput): Sql {
  const parts: Sql[] = [];
  if (input.workspaceId) parts.push(sql` AND p.workspace_id = ${input.workspaceId}`);
  if (input.createdBy) parts.push(sql` AND p.created_by = ${input.createdBy}`);
  if (input.updatedAfter) parts.push(sql` AND p.updated_at > ${input.updatedAfter}::timestamptz`);
  if (input.type === 'page') {
    parts.push(sql` AND p.is_database = false AND p.collection_id IS NULL`);
  } else if (input.type === 'database') {
    parts.push(sql` AND (p.is_database = true OR p.collection_id IS NOT NULL)`);
  }
  return parts.length === 0 ? sql.empty : sql.join(parts, '');
}

interface HitRow {
  page_id: string;
  block_id: string | null;
  workspace_id: string;
  title_plain: string | null;
  icon: string | null;
  updated_at: Date;
  is_database: boolean;
  collection_id: string | null;
  body: string | null;
  score: number;
  headline?: string | null;
}

function resultType(row: HitRow): SearchResultType {
  // 注意順序：database 的「容器頁」is_database=true 且 collection_id 也有值，
  // 它的「列」則是 is_database=false + collection_id 有值（見 databases/service.ts）
  if (row.is_database) return 'database';
  if (row.collection_id) return 'row';
  return 'page';
}

/* ── 路徑 A：tsvector ─────────────────────────────────── */

async function runTsSearch(
  userId: string,
  input: SearchInput,
  tsquery: string,
): Promise<HitRow[]> {
  const filters = pageFilters(input);
  return db.query<HitRow>(sql`
    WITH q AS (SELECT to_tsquery('simple', ${tsquery}) AS tsq),
    page_hits AS (
      SELECT p.id AS page_id, NULL::uuid AS block_id, p.workspace_id, p.title_plain, p.icon,
             p.updated_at, p.is_database, p.collection_id,
             left(coalesce(nullif(p.props_plain, ''), p.title_plain, ''), 4000) AS body,
             -- 標題命中加權：ts_rank_cd 已經給 A 權重較高分，再乘 4 讓
             -- 「標題就是它」永遠排在「內文提到它」前面
             ts_rank_cd(p.search_tsv, q.tsq, 32) * 4.0 AS base
        FROM pages p
        JOIN workspace_members m
          ON m.workspace_id = p.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
        CROSS JOIN q
       WHERE p.deleted_at IS NULL AND p.search_tsv @@ q.tsq${filters}
       ORDER BY base DESC
       LIMIT ${CANDIDATE_LIMIT}
    ),
    block_hits AS (
      SELECT p.id AS page_id, b.id AS block_id, p.workspace_id, p.title_plain, p.icon,
             b.updated_at, p.is_database, p.collection_id,
             left(b.plain_text, 4000) AS body,
             ts_rank_cd(b.search_tsv, q.tsq, 32) AS base
        FROM blocks b
        JOIN pages p ON p.id = b.page_id AND p.deleted_at IS NULL
        JOIN workspace_members m
          ON m.workspace_id = p.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
        CROSS JOIN q
       WHERE b.deleted_at IS NULL AND b.search_tsv @@ q.tsq${filters}
       ORDER BY base DESC
       LIMIT ${CANDIDATE_LIMIT}
    ),
    merged AS (SELECT * FROM page_hits UNION ALL SELECT * FROM block_hits),
    -- 一頁只回一筆（標題命中優先），使用者要的是「哪一頁」而不是「哪一段」
    best AS (
      SELECT DISTINCT ON (page_id)
             page_id, block_id, workspace_id, title_plain, icon, updated_at,
             is_database, collection_id, body,
             -- 時間衰減（03 §7.4 的自研排序公式）：30 天半衰
             base * (1.0 + 0.5 * exp(
               -extract(epoch FROM (now() - updated_at)) / 2592000.0)) AS score
        FROM merged
       ORDER BY page_id, base DESC, block_id ASC NULLS FIRST
    )
    SELECT s.page_id, s.block_id, s.workspace_id, s.title_plain, s.icon, s.updated_at,
           s.is_database, s.collection_id, s.body, s.score,
           ts_headline('simple', coalesce(s.body, ''), q.tsq, ${TS_HEADLINE_OPTIONS}) AS headline
      FROM (SELECT * FROM best ORDER BY score DESC, updated_at DESC LIMIT ${CANDIDATE_LIMIT}) s
      CROSS JOIN q
     ORDER BY s.score DESC, s.updated_at DESC
  `);
}

/* ── 路徑 B：pg_trgm fallback ─────────────────────────── */

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

async function runTrigramSearch(userId: string, input: SearchInput): Promise<HitRow[]> {
  const filters = pageFilters(input);
  const pattern = `%${escapeLike(input.q)}%`;
  return db.query<HitRow>(sql`
    WITH page_hits AS (
      SELECT p.id AS page_id, NULL::uuid AS block_id, p.workspace_id, p.title_plain, p.icon,
             p.updated_at, p.is_database, p.collection_id,
             left(coalesce(nullif(p.props_plain, ''), p.title_plain, ''), 4000) AS body,
             2.0 + similarity(coalesce(p.title_plain, ''), ${input.q}) AS base
        FROM pages p
        JOIN workspace_members m
          ON m.workspace_id = p.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
       WHERE p.deleted_at IS NULL
         AND (p.title_plain ILIKE ${pattern} OR p.props_plain ILIKE ${pattern})${filters}
       LIMIT ${CANDIDATE_LIMIT}
    ),
    block_hits AS (
      SELECT p.id AS page_id, b.id AS block_id, p.workspace_id, p.title_plain, p.icon,
             b.updated_at, p.is_database, p.collection_id,
             left(b.plain_text, 4000) AS body,
             1.0 + similarity(b.plain_text, ${input.q}) AS base
        FROM blocks b
        JOIN pages p ON p.id = b.page_id AND p.deleted_at IS NULL
        JOIN workspace_members m
          ON m.workspace_id = p.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
       WHERE b.deleted_at IS NULL AND b.plain_text ILIKE ${pattern}${filters}
       LIMIT ${CANDIDATE_LIMIT}
    ),
    merged AS (SELECT * FROM page_hits UNION ALL SELECT * FROM block_hits)
    SELECT DISTINCT ON (page_id)
           page_id, block_id, workspace_id, title_plain, icon, updated_at,
           is_database, collection_id, body, base AS score, NULL::text AS headline
      FROM merged
     ORDER BY page_id, base DESC, block_id ASC NULLS FIRST
  `);
}

/* ── 權限第二層 ───────────────────────────────────────── */

async function workspaceNeedsRefinement(
  workspaceId: string,
  userId: string,
): Promise<'skip' | 'refine' | 'deny'> {
  const role = await getMemberRole(workspaceId, userId);
  if (!role) return 'deny';
  if (role === 'owner' || role === 'admin') return 'skip';
  if (role === 'guest') return 'refine';
  const row = await db.queryOne<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM page_permissions WHERE workspace_id = ${workspaceId}
    ) AS exists
  `);
  return row?.exists ? 'refine' : 'skip';
}

async function filterByPagePermission(userId: string, rows: HitRow[]): Promise<HitRow[]> {
  if (rows.length === 0) return rows;
  const modes = new Map<string, 'skip' | 'refine' | 'deny'>();
  for (const wsId of new Set(rows.map((r) => r.workspace_id))) {
    modes.set(wsId, await workspaceNeedsRefinement(wsId, userId));
  }

  const kept: HitRow[] = [];
  for (const row of rows) {
    const mode = modes.get(row.workspace_id) ?? 'deny';
    if (mode === 'deny') continue;
    if (mode === 'skip') {
      kept.push(row);
      continue;
    }
    const permission = await resolvePagePermission(userId, row.page_id);
    if (permission !== 'none') kept.push(row);
  }
  return kept;
}

/* ── 組裝 ─────────────────────────────────────────────── */

function toHit(row: HitRow, tokens: string[], parents: Map<string, string[]>): SearchHit {
  const title = row.title_plain && row.title_plain.length > 0 ? row.title_plain : '未命名';
  // ts_headline 在中文內容上標不到東西（'simple' parser 不斷 CJK），
  // 所以哨兵沒出現時就改用應用層高亮，兩者用同一組 token。
  const snippet = headlineHasSentinel(row.headline)
    ? sanitizeHeadline(row.headline as string)
    : buildSnippet(row.body ?? '', tokens);
  return {
    pageId: row.page_id,
    blockId: row.block_id,
    workspaceId: row.workspace_id,
    title,
    icon: row.icon,
    snippet,
    parentTitles: parents.get(row.page_id) ?? [],
    updatedAt: row.updated_at.toISOString(),
    type: resultType(row),
    score: Number(row.score),
  };
}

function recentToHit(recent: RecentPage): SearchHit {
  return {
    pageId: recent.pageId,
    blockId: null,
    workspaceId: recent.workspaceId,
    title: recent.title,
    icon: recent.icon,
    snippet: '',
    parentTitles: recent.parentTitles,
    updatedAt: recent.updatedAt,
    type: recent.type,
    score: 0,
  };
}

export async function search(input: SearchInput, userId: string): Promise<SearchResponse> {
  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const offset = decodeCursor(input.cursor);
  const parsed = parseQuery(input.q);

  // 空查詢 → 最近瀏覽（搜尋框剛打開的空狀態）
  if (parsed.raw.length === 0) {
    if (!input.workspaceId) throw workspaceNotFound();
    const recent = await listRecentPages(input.workspaceId, userId, limit);
    return { query: '', hits: recent.map(recentToHit), nextCursor: null, recent: true, tokens: [] };
  }

  if (input.workspaceId && !(await getMemberRole(input.workspaceId, userId))) {
    throw workspaceNotFound();
  }

  let rows: HitRow[] = [];
  if (parsed.tsquery && !parsed.needsTrigramFallback) {
    rows = await runTsSearch(userId, input, parsed.tsquery);
  }
  // 短查詢或 tsvector 沒命中 → trgm 子字串比對（中文單字、錯字、英文詞中間）
  if (rows.length === 0) {
    rows = await runTrigramSearch(userId, input);
  }

  const permitted = await filterByPagePermission(userId, rows);
  const page = permitted.slice(offset, offset + limit);
  const parents = await loadParentTitles(page.map((r) => r.page_id));

  return {
    query: parsed.raw,
    hits: page.map((row) => toHit(row, parsed.tokens, parents)),
    nextCursor: permitted.length > offset + limit ? encodeCursor(offset + limit) : null,
    recent: false,
    tokens: parsed.tokens,
  };
}
