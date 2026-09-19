/**
 * 通知中心的前端狀態（04 §8 M5-10）。
 * 兩個來源：開啟收件匣時打 GET /api/notifications，之後靠 WS 的 `notification` 即時補進來。
 */
import type { Notification, NotificationListResponse, PublicUser } from '@kennote/shared-types';
import { COLLAB_API_ROUTES } from '@kennote/shared-types';
import { createStore, useStore } from '@kennote/ui';
import { api } from '../lib/api-client';

export interface NotificationsState {
  items: Notification[];
  users: Record<string, PublicUser>;
  unread: number;
  loading: boolean;
  loaded: boolean;
  nextCursor: string | null;
  error: string | null;
}

export const notificationsStore = createStore<NotificationsState>({
  items: [],
  users: {},
  unread: 0,
  loading: false,
  loaded: false,
  nextCursor: null,
  error: null,
});

export async function loadInbox(options: { append?: boolean } = {}): Promise<void> {
  const { nextCursor } = notificationsStore.getState();
  if (options.append && !nextCursor) return;
  notificationsStore.setState((prev) => ({ ...prev, loading: true, error: null }));
  try {
    const data = await api.get<NotificationListResponse>(COLLAB_API_ROUTES.notifications, {
      ...(options.append && nextCursor ? { before: nextCursor } : {}),
      limit: 30,
    });
    notificationsStore.setState((prev) => ({
      ...prev,
      items: options.append ? [...prev.items, ...data.notifications] : data.notifications,
      users: { ...prev.users, ...data.users },
      unread: data.unread,
      nextCursor: data.nextCursor,
      loading: false,
      loaded: true,
    }));
  } catch (err) {
    notificationsStore.setState((prev) => ({
      ...prev,
      loading: false,
      error: err instanceof Error ? err.message : '載入通知失敗',
    }));
  }
}

/** WS 推播進來的新通知（未讀數以伺服器算的為準） */
export function applyIncomingNotification(notification: Notification, unread: number): void {
  notificationsStore.setState((prev) => {
    if (prev.items.some((n) => n.id === notification.id)) {
      return { ...prev, unread };
    }
    return { ...prev, items: [notification, ...prev.items].slice(0, 200), unread };
  });
}

export async function markNotificationRead(id: string): Promise<void> {
  // 樂觀更新：先把 UI 改掉，失敗再由下一次 loadInbox 修正
  notificationsStore.setState((prev) => ({
    ...prev,
    items: prev.items.map((n) =>
      n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n,
    ),
    unread: Math.max(0, prev.unread - (prev.items.find((n) => n.id === id)?.readAt ? 0 : 1)),
  }));
  await api.post(COLLAB_API_ROUTES.notificationRead(id)).catch(() => undefined);
}

export async function markAllNotificationsRead(): Promise<void> {
  const now = new Date().toISOString();
  notificationsStore.setState((prev) => ({
    ...prev,
    items: prev.items.map((n) => (n.readAt ? n : { ...n, readAt: now })),
    unread: 0,
  }));
  await api.post(COLLAB_API_ROUTES.notificationsReadAll).catch(() => undefined);
}

export function useNotifications(): NotificationsState {
  return useStore(notificationsStore);
}

/** 側邊欄的未讀 badge 只需要數字，不要因為列表變動而重繪 */
export function useUnreadCount(): number {
  return useStore(notificationsStore, (s) => s.unread);
}

/**
 * 頁面追蹤 / 靜音（第六輪補）。
 *
 * 後端 `POST /api/notifications/subscriptions` 從 M5 就在了，但**前端沒有任何
 * 呼叫端** —— 「追蹤這一頁 / 不再通知我」在 UI 上完全做不到。
 * `COLLAB_API_ROUTES` 也沒有這一條，所以路徑寫在這裡。
 *
 * 注意後端目前只是把 `kind` 存起來：`listPageSubscribers()` 是 dead code，
 * 通知只對「留言裡被提及的人 + 討論串參與者」扇出，
 * 所以 `explicit` 目前不會讓你收到別人的編輯通知（見 round6 §4）。
 * `muted` 也一樣還沒被扇出端讀到。
 */
export const NOTIFICATION_SUBSCRIPTIONS_ROUTE = '/api/notifications/subscriptions';

export async function setPageSubscription(
  pageId: string,
  kind: 'explicit' | 'muted',
): Promise<void> {
  await api.post(NOTIFICATION_SUBSCRIPTIONS_ROUTE, { pageId, kind });
}
