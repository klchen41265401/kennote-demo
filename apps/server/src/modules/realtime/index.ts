/**
 * 即時同步的組裝點（04 §6）。**所有掛勾都在這裡接上**，
 * 因此 service 層彼此不必互相 import，也就沒有循環相依：
 *
 *   applyTransaction ──setBroadcaster──▶ RoomManager ──▶ 各連線
 *   comments/service ──setCommentBroadcaster──▶ RoomManager
 *   notifications/service ──setNotificationPusher──▶ RoomManager（user channel）
 *   applyTransaction ──setPermissionGuard──▶ permissions/service
 *   applyTransaction ──setTransactionNotifier──▶ notifications/fanout
 */
import { logger } from '../../lib/logger.js';
import { setBroadcaster } from '../blocks/apply-transaction.js';
import { setCommentBroadcaster } from '../comments/service.js';
import { registerTransactionNotifier } from '../notifications/fanout.js';
import { setNotificationPusher } from '../notifications/service.js';
import { registerPermissionGuard } from '../permissions/service.js';
import { getBroadcastAdapter } from './broadcast.js';
import { getRoomManager, RoomManager, setRoomManager } from './room-manager.js';

let initialized = false;

export function initRealtime(): RoomManager {
  const rooms = getRoomManager(getBroadcastAdapter());
  if (initialized) return rooms;
  initialized = true;

  // 1) transaction commit 之後廣播給同一個 page room（排除提交者自己的 session）
  setBroadcaster((result, originSessionId) => {
    void rooms
      .publishToPage(result.pageId, { t: 'txBroadcast', result }, originSessionId)
      .catch((err) => logger.warn({ err }, 'txBroadcast 廣播失敗'));
  });

  // 2) 留言事件即時推給正在看同一頁的人
  setCommentBroadcaster((pageId, event, discussion, comment) => {
    void rooms
      .publishToPage(pageId, {
        t: 'comment',
        pageId,
        event,
        discussion,
        ...(comment ? { comment } : {}),
      })
      .catch((err) => logger.warn({ err }, 'comment 廣播失敗'));
  });

  // 3) 通知推播（user channel，跨頁面、跨實例）
  setNotificationPusher((userId, notification, unread) => {
    void rooms
      .publishNotification(userId, notification, unread)
      .catch((err) => logger.warn({ err }, 'notification 推播失敗'));
  });

  // 4) 權限守門員：所有 block 寫入都會經過（guest 只能留言不能編輯）
  registerPermissionGuard();

  // 5) 第七輪：transaction commit 之後的通知扇出
  //    （block 裡的 @提及 → mention、explicit 訂閱者 → page_updated）
  registerTransactionNotifier();

  return rooms;
}

/** 測試 / 關機：拆掉掛勾與房間 */
export async function shutdownRealtime(): Promise<void> {
  const rooms = getRoomManager(getBroadcastAdapter());
  await rooms.dispose();
  setRoomManager(null);
  initialized = false;
}

export { getRoomManager } from './room-manager.js';
export { websocketRoutes } from './ws.js';
