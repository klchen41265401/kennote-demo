/**
 * 通知中心與頁面訂閱（03 §4.10、01 §6.3）。
 *
 * `payload` 刻意反正規化存快照（頁面標題、留言片段），
 * 收件匣列出 50 則時不必 JOIN 50 次，頁面被刪掉通知也不會壞掉。
 */
import type { PublicUser } from './page.js';

export type NotificationType =
  | 'mention'
  | 'comment_reply'
  | 'comment_resolved'
  | 'page_shared'
  | 'invite'
  | 'permission_changed'
  | 'page_updated';

export interface NotificationPayload {
  pageTitle?: string;
  snippet?: string;
  actorName?: string;
  workspaceName?: string;
  role?: string;
  [key: string]: unknown;
}

export interface Notification {
  id: string;
  workspaceId: string;
  recipientId: string;
  actorId: string | null;
  type: NotificationType;
  pageId: string | null;
  blockId: string | null;
  discussionId: string | null;
  commentId: string | null;
  payload: NotificationPayload;
  /** 聚合鍵：同一頁 5 分鐘內的多次編輯合併成一則 */
  groupKey: string | null;
  readAt: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  notifications: Notification[];
  unread: number;
  users: Record<string, PublicUser>;
  nextCursor: string | null;
}

export type SubscriptionKind = 'explicit' | 'auto' | 'muted';

export interface PageSubscription {
  userId: string;
  pageId: string;
  workspaceId: string;
  kind: SubscriptionKind;
  createdAt: string;
}

/** 聚合窗口：同一個 (type, page) 在這段時間內只產生一則通知 */
export const NOTIFICATION_GROUP_WINDOW_MS = 5 * 60_000;

export function notificationGroupKey(
  type: NotificationType,
  targetId: string | null,
  at: Date = new Date(),
): string {
  const bucket = Math.floor(at.getTime() / NOTIFICATION_GROUP_WINDOW_MS);
  return `${type}:${targetId ?? '-'}:${bucket}`;
}
