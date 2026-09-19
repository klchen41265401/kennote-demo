/**
 * 留言資料層（03 §4.9）。
 * discussions 掛在 page_id（必填）+ block_id（可為 NULL = 頁面層級討論串）。
 */
import type { Comment, Discussion, DiscussionAnchor, RichText } from '@kennote/shared-types';
import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';

export interface DiscussionRow {
  id: string;
  workspace_id: string;
  page_id: string;
  block_id: string | null;
  anchor: DiscussionAnchor;
  resolved_at: Date | null;
  resolved_by: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface CommentRow {
  id: string;
  workspace_id: string;
  discussion_id: string;
  author_id: string | null;
  body: RichText;
  plain_text: string;
  mentioned_users: string[];
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const DISCUSSION_COLUMNS = sql.raw(
  'id, workspace_id, page_id, block_id, anchor, resolved_at, resolved_by, created_by, ' +
    'created_at, updated_at, deleted_at',
);

const COMMENT_COLUMNS = sql.raw(
  'id, workspace_id, discussion_id, author_id, body, plain_text, mentioned_users, ' +
    'created_at, updated_at, deleted_at',
);

export function toComment(row: CommentRow): Comment {
  const deleted = row.deleted_at !== null;
  return {
    id: row.id,
    discussionId: row.discussion_id,
    workspaceId: row.workspace_id,
    authorId: row.author_id,
    body: deleted ? [] : (row.body ?? []),
    plainText: deleted ? '' : row.plain_text,
    mentionedUserIds: row.mentioned_users ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
  };
}

export function toDiscussion(row: DiscussionRow, comments: Comment[]): Discussion {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    pageId: row.page_id,
    blockId: row.block_id,
    anchor: row.anchor ?? { kind: 'page' },
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    resolvedBy: row.resolved_by,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    comments,
  };
}

/* ── 讀 ───────────────────────────────────────────────── */

export async function listDiscussionsByPage(
  pageId: string,
  conn: Queryable = db,
): Promise<DiscussionRow[]> {
  return conn.query<DiscussionRow>(sql`
    SELECT ${DISCUSSION_COLUMNS} FROM discussions
     WHERE page_id = ${pageId} AND deleted_at IS NULL
     ORDER BY created_at ASC
  `);
}

export async function listCommentsByDiscussions(
  discussionIds: string[],
  conn: Queryable = db,
): Promise<CommentRow[]> {
  if (discussionIds.length === 0) return [];
  return conn.query<CommentRow>(sql`
    SELECT ${COMMENT_COLUMNS} FROM comments
     WHERE discussion_id = ANY(${discussionIds}::uuid[])
     ORDER BY created_at ASC
  `);
}

export async function findDiscussion(
  id: string,
  conn: Queryable = db,
): Promise<DiscussionRow | null> {
  return conn.queryOne<DiscussionRow>(sql`
    SELECT ${DISCUSSION_COLUMNS} FROM discussions WHERE id = ${id} AND deleted_at IS NULL
  `);
}

export async function findComment(id: string, conn: Queryable = db): Promise<CommentRow | null> {
  return conn.queryOne<CommentRow>(sql`
    SELECT ${COMMENT_COLUMNS} FROM comments WHERE id = ${id} AND deleted_at IS NULL
  `);
}

/** 討論串的參與者（回覆通知的收件人） */
export async function listParticipants(
  discussionId: string,
  conn: Queryable = db,
): Promise<string[]> {
  const rows = await conn.query<{ author_id: string }>(sql`
    SELECT DISTINCT author_id FROM comments
     WHERE discussion_id = ${discussionId} AND author_id IS NOT NULL AND deleted_at IS NULL
  `);
  return rows.map((r) => r.author_id);
}

/* ── 寫 ───────────────────────────────────────────────── */

export async function insertDiscussion(
  conn: Queryable,
  input: {
    id?: string;
    workspaceId: string;
    pageId: string;
    blockId: string | null;
    anchor: DiscussionAnchor;
    createdBy: string;
  },
): Promise<DiscussionRow> {
  const idFragment = input.id ? sql`${input.id}::uuid` : sql`uuid_generate_v7()`;
  const row = await conn.queryOne<DiscussionRow>(sql`
    INSERT INTO discussions (id, workspace_id, page_id, block_id, anchor, created_by)
    VALUES (${idFragment}, ${input.workspaceId}, ${input.pageId}, ${input.blockId},
            ${JSON.stringify(input.anchor)}::jsonb, ${input.createdBy})
    RETURNING ${DISCUSSION_COLUMNS}
  `);
  if (!row) throw new Error('建立討論串失敗');
  return row;
}

export async function insertComment(
  conn: Queryable,
  input: {
    workspaceId: string;
    discussionId: string;
    authorId: string;
    body: RichText;
    plainText: string;
    mentionedUserIds: string[];
  },
): Promise<CommentRow> {
  const row = await conn.queryOne<CommentRow>(sql`
    INSERT INTO comments (workspace_id, discussion_id, author_id, body, plain_text, mentioned_users)
    VALUES (${input.workspaceId}, ${input.discussionId}, ${input.authorId},
            ${JSON.stringify(input.body)}::jsonb, ${input.plainText},
            ${input.mentionedUserIds}::uuid[])
    RETURNING ${COMMENT_COLUMNS}
  `);
  if (!row) throw new Error('新增留言失敗');
  return row;
}

export async function updateComment(
  conn: Queryable,
  id: string,
  input: { body: RichText; plainText: string; mentionedUserIds: string[] },
): Promise<CommentRow | null> {
  return conn.queryOne<CommentRow>(sql`
    UPDATE comments
       SET body = ${JSON.stringify(input.body)}::jsonb,
           plain_text = ${input.plainText},
           mentioned_users = ${input.mentionedUserIds}::uuid[]
     WHERE id = ${id} AND deleted_at IS NULL
     RETURNING ${COMMENT_COLUMNS}
  `);
}

export async function softDeleteComment(
  conn: Queryable,
  id: string,
): Promise<CommentRow | null> {
  return conn.queryOne<CommentRow>(sql`
    UPDATE comments SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL
     RETURNING ${COMMENT_COLUMNS}
  `);
}

export async function setResolved(
  conn: Queryable,
  id: string,
  userId: string | null,
  resolved: boolean,
): Promise<DiscussionRow | null> {
  const sets = resolved
    ? sql`resolved_at = now(), resolved_by = ${userId}`
    : sql`resolved_at = NULL, resolved_by = NULL`;
  return conn.queryOne<DiscussionRow>(sql`
    UPDATE discussions SET ${sets}
     WHERE id = ${id} AND deleted_at IS NULL
     RETURNING ${DISCUSSION_COLUMNS}
  `);
}

export async function softDeleteDiscussion(conn: Queryable, id: string): Promise<void> {
  await conn.query(sql`
    UPDATE discussions SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL
  `);
}

export async function countOpenDiscussions(
  pageId: string,
  conn: Queryable = db,
): Promise<number> {
  const row = await conn.queryOne<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM discussions
     WHERE page_id = ${pageId} AND resolved_at IS NULL AND deleted_at IS NULL
  `);
  return Number(row?.count ?? 0);
}
