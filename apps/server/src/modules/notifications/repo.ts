/**
 * 通知 / 訂閱資料層（03 §4.10）。
 * notifications.payload 存的是渲染用快照，列表查詢不必 JOIN 頁面與留言。
 */
import type { Notification, NotificationPayload, NotificationType } from '@kennote/shared-types';
import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';

export interface NotificationRow {
  id: string;
  workspace_id: string;
  recipient_id: string;
  actor_id: string | null;
  type: NotificationType;
  page_id: string | null;
  block_id: string | null;
  discussion_id: string | null;
  comment_id: string | null;
  payload: NotificationPayload;
  group_key: string | null;
  read_at: Date | null;
  archived_at: Date | null;
  created_at: Date;
}

const COLUMNS = sql.raw(
  'id, workspace_id, recipient_id, actor_id, type, page_id, block_id, discussion_id, ' +
    'comment_id, payload, group_key, read_at, archived_at, created_at',
);

export function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    recipientId: row.recipient_id,
    actorId: row.actor_id,
    type: row.type,
    pageId: row.page_id,
    blockId: row.block_id,
    discussionId: row.discussion_id,
    commentId: row.comment_id,
    payload: row.payload ?? {},
    groupKey: row.group_key,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export interface InsertNotificationInput {
  workspaceId: string;
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  pageId?: string | null;
  blockId?: string | null;
  discussionId?: string | null;
  commentId?: string | null;
  payload?: NotificationPayload;
  groupKey?: string | null;
}

/**
 * 插入一則通知。帶 groupKey 時靠 uq_notif_group 做去重
 * （同一頁 5 分鐘內的多次事件只留第一則），回 null 代表被聚合掉了。
 */
export async function insertNotification(
  conn: Queryable,
  input: InsertNotificationInput,
): Promise<NotificationRow | null> {
  return conn.queryOne<NotificationRow>(sql`
    INSERT INTO notifications (workspace_id, recipient_id, actor_id, type, page_id, block_id,
                               discussion_id, comment_id, payload, group_key)
    VALUES (${input.workspaceId}, ${input.recipientId}, ${input.actorId}, ${input.type},
            ${input.pageId ?? null}, ${input.blockId ?? null}, ${input.discussionId ?? null},
            ${input.commentId ?? null}, ${JSON.stringify(input.payload ?? {})}::jsonb,
            ${input.groupKey ?? null})
    ON CONFLICT (recipient_id, group_key) WHERE group_key IS NOT NULL DO NOTHING
    RETURNING ${COLUMNS}
  `);
}

export async function listNotifications(
  userId: string,
  opts: { limit: number; before?: string | null; unreadOnly?: boolean },
  conn: Queryable = db,
): Promise<NotificationRow[]> {
  const cursor = opts.before ? sql` AND id < ${opts.before}::uuid` : sql.empty;
  const unread = opts.unreadOnly ? sql` AND read_at IS NULL` : sql.empty;
  return conn.query<NotificationRow>(sql`
    SELECT ${COLUMNS} FROM notifications
     WHERE recipient_id = ${userId} AND archived_at IS NULL${cursor}${unread}
     ORDER BY created_at DESC, id DESC
     LIMIT ${opts.limit}
  `);
}

export async function countUnread(userId: string, conn: Queryable = db): Promise<number> {
  const row = await conn.queryOne<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM notifications
     WHERE recipient_id = ${userId} AND read_at IS NULL AND archived_at IS NULL
  `);
  return Number(row?.count ?? 0);
}

export async function markRead(
  conn: Queryable,
  userId: string,
  notificationId: string,
): Promise<NotificationRow | null> {
  return conn.queryOne<NotificationRow>(sql`
    UPDATE notifications SET read_at = coalesce(read_at, now())
     WHERE id = ${notificationId} AND recipient_id = ${userId}
     RETURNING ${COLUMNS}
  `);
}

export async function markAllRead(conn: Queryable, userId: string): Promise<number> {
  const rows = await conn.query<{ id: string }>(sql`
    UPDATE notifications SET read_at = now()
     WHERE recipient_id = ${userId} AND read_at IS NULL AND archived_at IS NULL
     RETURNING id
  `);
  return rows.length;
}

/* ── 頁面訂閱 ─────────────────────────────────────────── */

export async function upsertSubscription(
  conn: Queryable,
  input: { userId: string; pageId: string; workspaceId: string; kind: 'explicit' | 'auto' | 'muted' },
): Promise<void> {
  // 'auto' 不會覆蓋使用者自己設定的 explicit / muted
  const conflict =
    input.kind === 'auto'
      ? sql`DO NOTHING`
      : sql`DO UPDATE SET kind = EXCLUDED.kind`;
  await conn.query(sql`
    INSERT INTO subscriptions (user_id, page_id, workspace_id, kind)
    VALUES (${input.userId}, ${input.pageId}, ${input.workspaceId}, ${input.kind})
    ON CONFLICT (user_id, page_id) ${conflict}
  `);
}

export async function listSubscribers(
  pageId: string,
  conn: Queryable = db,
): Promise<string[]> {
  const rows = await conn.query<{ user_id: string }>(sql`
    SELECT user_id FROM subscriptions WHERE page_id = ${pageId} AND kind <> 'muted'
  `);
  return rows.map((r) => r.user_id);
}

export async function findPageContext(
  pageId: string,
  conn: Queryable = db,
): Promise<{ workspace_id: string; title_plain: string | null } | null> {
  return conn.queryOne(sql`
    SELECT workspace_id, title_plain FROM pages WHERE id = ${pageId}
  `);
}
