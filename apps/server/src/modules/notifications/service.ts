/**
 * 通知中心（01 §6.3、04 §8 M5-10）。**不認識 HTTP / WS**。
 *
 * 兩條路徑：
 *   1. 寫進 notifications 表（收件匣、未讀 badge）
 *   2. 若收件人此刻在線 → 透過 room-manager 的 user channel 即時推 `notification`
 *
 * 去重：帶 groupKey 的通知在 5 分鐘窗口內只會留下第一則（uq_notif_group）。
 * 這讓「某人一直在編輯這頁」不會洗版（01 §6 M5.3.3 的通知風暴警告）。
 */
import type {
  Notification,
  NotificationListResponse,
  NotificationPayload,
  NotificationType,
  PublicUser,
} from '@kennote/shared-types';
import { withTransaction } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { listUsersByIds } from '../permissions/repo.js';
// ⚠️ 循環引用（permissions/service → notifications/fanout → 這裡）是刻意的：
// 兩邊都只在函式內用，ESM 的 live binding 解得開，與 fanout.ts 同一個形狀。
import { requirePagePermission } from '../permissions/service.js';
import * as repo from './repo.js';

/** room-manager 的推播掛勾。由 realtime/index.ts 在啟動時接上，避免模組循環相依 */
type PushFn = (userId: string, notification: Notification, unread: number) => void;
let push: PushFn = () => {};
export function setNotificationPusher(fn: PushFn): void {
  push = fn;
}

export interface NotifyInput extends repo.InsertNotificationInput {}

/** 建立一則通知並即時推播。回 null 代表被聚合掉（groupKey 已存在） */
export async function notify(input: NotifyInput): Promise<Notification | null> {
  // 不通知自己
  if (input.actorId && input.actorId === input.recipientId) return null;

  const row = await withTransaction((tx) => repo.insertNotification(tx, input));
  if (!row) return null;

  const notification = repo.toNotification(row);
  const unread = await repo.countUnread(input.recipientId);
  try {
    push(input.recipientId, notification, unread);
  } catch {
    /* 推播失敗不影響資料寫入 */
  }
  return notification;
}

export async function notifyMany(inputs: NotifyInput[]): Promise<number> {
  let created = 0;
  for (const input of inputs) {
    const n = await notify(input);
    if (n) created += 1;
  }
  return created;
}

/* ── 收件匣 ───────────────────────────────────────────── */

export async function listInbox(
  userId: string,
  opts: { limit?: number; before?: string | null; unreadOnly?: boolean } = {},
): Promise<NotificationListResponse> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const rows = await repo.listNotifications(userId, {
    limit: limit + 1,
    before: opts.before ?? null,
    unreadOnly: opts.unreadOnly ?? false,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const notifications = page.map(repo.toNotification);

  const actorIds = [...new Set(notifications.map((n) => n.actorId).filter((v): v is string => !!v))];
  const users: Record<string, PublicUser> = {};
  for (const u of await listUsersByIds(actorIds)) {
    users[u.id] = { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatar_url };
  }

  return {
    notifications,
    unread: await repo.countUnread(userId),
    users,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function markRead(userId: string, notificationId: string): Promise<Notification> {
  const row = await withTransaction((tx) => repo.markRead(tx, userId, notificationId));
  if (!row) throw new AppError('NOT_FOUND', '找不到這則通知');
  return repo.toNotification(row);
}

export async function markAllRead(userId: string): Promise<{ updated: number; unread: number }> {
  const updated = await withTransaction((tx) => repo.markAllRead(tx, userId));
  return { updated, unread: await repo.countUnread(userId) };
}

export async function unreadCount(userId: string): Promise<number> {
  return repo.countUnread(userId);
}

/* ── 訂閱 ─────────────────────────────────────────────── */

/**
 * 編輯 / 留言過的頁面自動追蹤（kind='auto'，不覆蓋使用者的 explicit / muted）。
 * 失敗不應該讓主流程掛掉，呼叫端一律 fire-and-forget。
 */
export async function touchSubscription(userId: string, pageId: string): Promise<void> {
  const page = await repo.findPageContext(pageId);
  if (!page) return;
  await withTransaction((tx) =>
    repo.upsertSubscription(tx, {
      userId,
      pageId,
      workspaceId: page.workspace_id,
      kind: 'auto',
    }),
  );
}

export async function setSubscription(
  userId: string,
  pageId: string,
  kind: 'explicit' | 'muted',
): Promise<void> {
  /*
   * 第八輪 BUG-43：原本只有「這一頁存在嗎」。baseline `none` 的 guest
   * 追蹤得起來任何一頁，之後每次有人編輯就收到一則帶**頁面標題**的
   * `page_updated` 通知 —— 等於用收件匣把第七輪堵住的標題洩漏重新打開，
   * 而且 200 還直接確認了「這個 pageId 存在」。
   */
  await requirePagePermission(userId, pageId, 'read');
  const page = await repo.findPageContext(pageId);
  if (!page) throw new AppError('PAGE_NOT_FOUND');
  await withTransaction((tx) =>
    repo.upsertSubscription(tx, { userId, pageId, workspaceId: page.workspace_id, kind }),
  );
}

/**
 * 第七輪：接上 `kinds` 篩選（原本整支是 dead code，見 notifications/fanout.ts）。
 * 不傳 kinds = 「沒有靜音的所有人」，與原本的行為一致。
 */
export async function listPageSubscribers(
  pageId: string,
  kinds?: Array<'explicit' | 'auto'>,
): Promise<string[]> {
  return repo.listSubscribers(pageId, kinds);
}

export async function pageTitleOf(pageId: string): Promise<string> {
  const page = await repo.findPageContext(pageId);
  return page?.title_plain ?? '未命名';
}

export type { NotificationPayload, NotificationType };
