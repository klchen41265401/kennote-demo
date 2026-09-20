/**
 * 留言系統（01 §6.2、04 §8 M5-9）。**不認識 HTTP / WS**。
 *
 * 權限：
 *   讀討論串 → 'read'
 *   新增 / 回覆 / 解決 → 'comment'   ← guest 只到這裡
 *   編輯 / 刪除他人的留言 → 只有作者本人，或頁面 'full'
 *
 * 行內留言的錨點是 rich text 上的 `{ t:'comment', id }` mark：
 * 前端先產生 discussionId，把 mark 寫進 block（走 applyTransaction），
 * 再用同一個 id 建立討論串 —— 因此 createDiscussion 接受 client 指定的 id。
 */
import type {
  Comment,
  CreateCommentRequest,
  CreateDiscussionRequest,
  Discussion,
  DiscussionAnchor,
  DiscussionListResponse,
  PublicUser,
  RichText,
  WorkspaceDiscussionItem,
  WorkspaceDiscussionsResponse,
} from '@kennote/shared-types';
import { extractMentionedUserIds, richTextToPlainText } from '@kennote/shared-types';
import { db, withTransaction } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import { AppError, pageNotFound } from '../../lib/errors.js';
import { notify, touchSubscription } from '../notifications/service.js';
import { listUsersByIds } from '../permissions/repo.js';
import { requirePagePermission, resolvePagePermission } from '../permissions/service.js';
import * as repo from './repo.js';

/** WS 廣播掛勾；由 realtime/index.ts 接上（避免模組循環相依） */
type CommentBroadcastFn = (
  pageId: string,
  event: 'created' | 'updated' | 'resolved' | 'reopened' | 'deleted',
  discussion: Discussion,
  comment?: Comment,
) => void;
let broadcastComment: CommentBroadcastFn = () => {};
export function setCommentBroadcaster(fn: CommentBroadcastFn): void {
  broadcastComment = fn;
}

const MAX_BODY_NODES = 2000;

function normalizeBody(body: RichText): { body: RichText; plainText: string; mentions: string[] } {
  if (!Array.isArray(body) || body.length === 0) {
    throw new AppError('VALIDATION_FAILED', '留言內容不能是空的');
  }
  if (body.length > MAX_BODY_NODES) {
    throw new AppError('PAYLOAD_TOO_LARGE', '留言內容過長');
  }
  const plainText = richTextToPlainText(body);
  const mentions = extractMentionedUserIds(body);
  if (plainText.trim().length === 0 && mentions.length === 0) {
    throw new AppError('VALIDATION_FAILED', '留言內容不能是空的');
  }
  return { body, plainText, mentions };
}

async function usersMap(ids: string[]): Promise<Record<string, PublicUser>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: Record<string, PublicUser> = {};
  for (const u of await listUsersByIds(unique)) {
    out[u.id] = { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatar_url };
  }
  return out;
}

/* ── 讀 ───────────────────────────────────────────────── */

export async function listPageDiscussions(
  pageId: string,
  userId: string,
): Promise<DiscussionListResponse> {
  await requirePagePermission(userId, pageId, 'read');

  const rows = await repo.listDiscussionsByPage(pageId);
  const comments = await repo.listCommentsByDiscussions(rows.map((r) => r.id));
  const byDiscussion = new Map<string, Comment[]>();
  for (const row of comments) {
    const list = byDiscussion.get(row.discussion_id) ?? [];
    list.push(repo.toComment(row));
    byDiscussion.set(row.discussion_id, list);
  }

  const discussions = rows.map((r) => repo.toDiscussion(r, byDiscussion.get(r.id) ?? []));
  const userIds = [
    ...discussions.flatMap((d) => [d.createdBy, d.resolvedBy]),
    ...comments.map((c) => c.author_id),
  ].filter((v): v is string => typeof v === 'string');

  return { pageId, discussions, users: await usersMap(userIds) };
}

/**
 * 跨頁的最近討論串（gap-review C-8）。
 *
 * ⚠️ 權限**一定要逐頁再問一次**（README §一-1 的主線：
 * 「你是不是這個工作區的人」不等於「你能不能看這一頁」）。
 * 這裡先撈工作區裡最近有動靜的討論串，再用 `resolvePagePermission()` 濾掉看不到的。
 */
export async function listWorkspaceDiscussions(
  workspaceId: string,
  userId: string,
  limit = 50,
): Promise<WorkspaceDiscussionsResponse> {
  const rows = await db.query<{
    id: string;
    page_id: string;
    page_title: RichText | null;
    page_icon: string | null;
    last_activity_at: Date;
  }>(sql`
    SELECT d.id,
           d.page_id,
           p.title AS page_title,
           p.icon  AS page_icon,
           GREATEST(d.created_at, COALESCE(MAX(c.created_at), d.created_at)) AS last_activity_at
      FROM discussions d
      JOIN pages p ON p.id = d.page_id
      LEFT JOIN comments c ON c.discussion_id = d.id AND c.deleted_at IS NULL
     WHERE d.workspace_id = ${workspaceId}
       AND d.deleted_at IS NULL
       AND p.deleted_at IS NULL
     GROUP BY d.id, d.created_at, d.page_id, p.title, p.icon
     ORDER BY last_activity_at DESC
     LIMIT ${limit * 3}
  `);

  const allowed = new Map<string, boolean>();
  const kept: typeof rows = [];
  for (const row of rows) {
    if (kept.length >= limit) break;
    let ok = allowed.get(row.page_id);
    if (ok === undefined) {
      ok = (await resolvePagePermission(userId, row.page_id)) !== 'none';
      allowed.set(row.page_id, ok);
    }
    if (ok) kept.push(row);
  }

  const discussionRows = await Promise.all(kept.map((r) => repo.findDiscussion(r.id)));
  const comments = await repo.listCommentsByDiscussions(kept.map((r) => r.id));
  const byDiscussion = new Map<string, Comment[]>();
  for (const row of comments) {
    const list = byDiscussion.get(row.discussion_id) ?? [];
    list.push(repo.toComment(row));
    byDiscussion.set(row.discussion_id, list);
  }

  const items: WorkspaceDiscussionItem[] = [];
  kept.forEach((row, i) => {
    const dRow = discussionRows[i];
    if (!dRow) return;
    items.push({
      discussion: repo.toDiscussion(dRow, byDiscussion.get(row.id) ?? []),
      pageId: row.page_id,
      pageTitle: richTextToPlainText(row.page_title ?? []) || '無標題',
      pageIcon: row.page_icon,
      lastActivityAt: row.last_activity_at.toISOString(),
    });
  });

  const userIds = items.flatMap((i) => [
    i.discussion.createdBy,
    i.discussion.resolvedBy,
    ...i.discussion.comments.map((c) => c.authorId),
  ]).filter((v): v is string => typeof v === 'string');

  return { workspaceId, items, users: await usersMap(userIds) };
}

async function loadDiscussionWithComments(discussionId: string): Promise<Discussion> {
  const row = await repo.findDiscussion(discussionId);
  if (!row) throw new AppError('NOT_FOUND', '找不到這個討論串');
  const comments = await repo.listCommentsByDiscussions([discussionId]);
  return repo.toDiscussion(row, comments.map(repo.toComment));
}

/* ── 寫 ───────────────────────────────────────────────── */

export async function createDiscussion(
  pageId: string,
  userId: string,
  input: CreateDiscussionRequest,
): Promise<Discussion> {
  await requirePagePermission(userId, pageId, 'comment');
  const page = await db.queryOne<{ workspace_id: string; title_plain: string | null }>(sql`
    SELECT workspace_id, title_plain FROM pages WHERE id = ${pageId} AND deleted_at IS NULL
  `);
  if (!page) throw pageNotFound();

  const { body, plainText, mentions } = normalizeBody(input.body);
  const blockId = input.blockId ?? null;
  const anchor: DiscussionAnchor =
    input.anchor ?? (blockId ? { kind: 'inline', quote: '' } : { kind: 'page' });

  const { discussion, comment } = await withTransaction(async (tx) => {
    const discussionRow = await repo.insertDiscussion(tx, {
      ...(input.discussionId ? { id: input.discussionId } : {}),
      workspaceId: page.workspace_id,
      pageId,
      blockId,
      anchor,
      createdBy: userId,
    });
    const commentRow = await repo.insertComment(tx, {
      workspaceId: page.workspace_id,
      discussionId: discussionRow.id,
      authorId: userId,
      body,
      plainText,
      mentionedUserIds: mentions,
    });
    return {
      discussion: repo.toDiscussion(discussionRow, [repo.toComment(commentRow)]),
      comment: repo.toComment(commentRow),
    };
  });

  broadcastComment(pageId, 'created', discussion, comment);
  void touchSubscription(userId, pageId).catch(() => {});
  await fanOutNotifications({
    workspaceId: page.workspace_id,
    pageId,
    pageTitle: page.title_plain ?? '未命名',
    actorId: userId,
    discussionId: discussion.id,
    comment,
    mentions,
    participants: [],
  });

  return discussion;
}

export async function addComment(
  discussionId: string,
  userId: string,
  input: CreateCommentRequest,
): Promise<Discussion> {
  const discussionRow = await repo.findDiscussion(discussionId);
  if (!discussionRow) throw new AppError('NOT_FOUND', '找不到這個討論串');
  await requirePagePermission(userId, discussionRow.page_id, 'comment');

  const { body, plainText, mentions } = normalizeBody(input.body);
  const participants = await repo.listParticipants(discussionId);

  const commentRow = await withTransaction((tx) =>
    repo.insertComment(tx, {
      workspaceId: discussionRow.workspace_id,
      discussionId,
      authorId: userId,
      body,
      plainText,
      mentionedUserIds: mentions,
    }),
  );
  const comment = repo.toComment(commentRow);
  const discussion = await loadDiscussionWithComments(discussionId);

  broadcastComment(discussionRow.page_id, 'created', discussion, comment);
  void touchSubscription(userId, discussionRow.page_id).catch(() => {});
  await fanOutNotifications({
    workspaceId: discussionRow.workspace_id,
    pageId: discussionRow.page_id,
    pageTitle: await pageTitle(discussionRow.page_id),
    actorId: userId,
    discussionId,
    comment,
    mentions,
    participants: [
      ...participants,
      ...(discussionRow.created_by ? [discussionRow.created_by] : []),
    ],
  });

  return discussion;
}

export async function editComment(
  commentId: string,
  userId: string,
  body: RichText,
): Promise<Discussion> {
  const commentRow = await repo.findComment(commentId);
  if (!commentRow) throw new AppError('NOT_FOUND', '找不到這則留言');
  const discussionRow = await repo.findDiscussion(commentRow.discussion_id);
  if (!discussionRow) throw new AppError('NOT_FOUND', '找不到這個討論串');

  const permission = await requirePagePermission(userId, discussionRow.page_id, 'comment');
  if (commentRow.author_id !== userId && permission !== 'full') {
    throw new AppError('FORBIDDEN', '只能編輯自己的留言');
  }

  const normalized = normalizeBody(body);
  await withTransaction((tx) =>
    repo.updateComment(tx, commentId, {
      body: normalized.body,
      plainText: normalized.plainText,
      mentionedUserIds: normalized.mentions,
    }),
  );

  const discussion = await loadDiscussionWithComments(commentRow.discussion_id);
  broadcastComment(discussionRow.page_id, 'updated', discussion);
  return discussion;
}

export async function deleteComment(
  commentId: string,
  userId: string,
): Promise<{ discussion: Discussion | null; discussionDeleted: boolean }> {
  const commentRow = await repo.findComment(commentId);
  if (!commentRow) throw new AppError('NOT_FOUND', '找不到這則留言');
  const discussionRow = await repo.findDiscussion(commentRow.discussion_id);
  if (!discussionRow) throw new AppError('NOT_FOUND', '找不到這個討論串');

  const permission = await requirePagePermission(userId, discussionRow.page_id, 'comment');
  if (commentRow.author_id !== userId && permission !== 'full') {
    throw new AppError('FORBIDDEN', '只能刪除自己的留言');
  }

  await withTransaction((tx) => repo.softDeleteComment(tx, commentId));
  const remaining = (await repo.listCommentsByDiscussions([commentRow.discussion_id])).filter(
    (c) => c.deleted_at === null,
  );

  // 討論串的所有留言都被刪掉 → 整串一起收掉（前端的 comment mark 會變成孤兒，由 UI 忽略）
  if (remaining.length === 0) {
    await withTransaction((tx) => repo.softDeleteDiscussion(tx, commentRow.discussion_id));
    const discussion = repo.toDiscussion(discussionRow, []);
    broadcastComment(discussionRow.page_id, 'deleted', discussion);
    return { discussion: null, discussionDeleted: true };
  }

  const discussion = await loadDiscussionWithComments(commentRow.discussion_id);
  broadcastComment(discussionRow.page_id, 'updated', discussion);
  return { discussion, discussionDeleted: false };
}

export async function setResolved(
  discussionId: string,
  userId: string,
  resolved: boolean,
): Promise<Discussion> {
  const discussionRow = await repo.findDiscussion(discussionId);
  if (!discussionRow) throw new AppError('NOT_FOUND', '找不到這個討論串');
  await requirePagePermission(userId, discussionRow.page_id, 'comment');

  const updated = await withTransaction((tx) =>
    repo.setResolved(tx, discussionId, resolved ? userId : null, resolved),
  );
  if (!updated) throw new AppError('NOT_FOUND', '找不到這個討論串');

  const discussion = await loadDiscussionWithComments(discussionId);
  broadcastComment(discussionRow.page_id, resolved ? 'resolved' : 'reopened', discussion);

  if (resolved && discussionRow.created_by && discussionRow.created_by !== userId) {
    await notify({
      workspaceId: discussionRow.workspace_id,
      recipientId: discussionRow.created_by,
      actorId: userId,
      type: 'comment_resolved',
      pageId: discussionRow.page_id,
      blockId: discussionRow.block_id,
      discussionId,
      payload: {
        pageTitle: await pageTitle(discussionRow.page_id),
        snippet: discussion.comments[0]?.plainText.slice(0, 120) ?? '',
      },
    });
  }
  return discussion;
}

/** 討論串是否還存在（前端 comment mark 清理用） */
export async function pageOpenDiscussionCount(pageId: string, userId: string): Promise<number> {
  const permission = await resolvePagePermission(userId, pageId);
  if (permission === 'none') throw pageNotFound();
  return repo.countOpenDiscussions(pageId);
}

/* ── 通知扇出 ─────────────────────────────────────────── */

async function pageTitle(pageId: string): Promise<string> {
  const row = await db.queryOne<{ title_plain: string | null }>(sql`
    SELECT title_plain FROM pages WHERE id = ${pageId}
  `);
  return row?.title_plain ?? '未命名';
}

interface FanOutInput {
  workspaceId: string;
  pageId: string;
  pageTitle: string;
  actorId: string;
  discussionId: string;
  comment: Comment;
  mentions: string[];
  participants: string[];
}

/**
 * 通知優先序：**被 @ 的人拿 mention，其他參與者拿 comment_reply，同一個人不會收到兩則。**
 * 被 @ 的人若沒有這一頁的讀取權限就不通知（不能靠 @ 探測私密頁面的存在）。
 */
async function fanOutNotifications(input: FanOutInput): Promise<void> {
  const snippet = input.comment.plainText.slice(0, 160);
  const mentioned = new Set(input.mentions.filter((id) => id !== input.actorId));
  const repliers = new Set(
    input.participants.filter((id) => id !== input.actorId && !mentioned.has(id)),
  );

  for (const recipientId of mentioned) {
    const permission = await resolvePagePermission(recipientId, input.pageId);
    if (permission === 'none') continue;
    await notify({
      workspaceId: input.workspaceId,
      recipientId,
      actorId: input.actorId,
      type: 'mention',
      pageId: input.pageId,
      discussionId: input.discussionId,
      commentId: input.comment.id,
      payload: { pageTitle: input.pageTitle, snippet },
    });
  }

  for (const recipientId of repliers) {
    const permission = await resolvePagePermission(recipientId, input.pageId);
    if (permission === 'none') continue;
    await notify({
      workspaceId: input.workspaceId,
      recipientId,
      actorId: input.actorId,
      type: 'comment_reply',
      pageId: input.pageId,
      discussionId: input.discussionId,
      commentId: input.comment.id,
      payload: { pageTitle: input.pageTitle, snippet },
    });
  }
}
