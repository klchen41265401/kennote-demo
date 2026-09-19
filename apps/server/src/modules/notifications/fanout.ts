/**
 * 第七輪：**頁面編輯**這條路上的通知扇出（第六輪 §5-3 ～ §5-6）。
 *
 * 第六輪查到的現況：
 *   - `fanOutNotifications()` 只在 `comments/service.ts` 被呼叫，
 *     頁面 block 裡的 `@提及` **永遠不會產生通知**（編輯器插得出 atom，白插的）
 *   - `listPageSubscribers()` 是 dead code：追蹤 / 靜音存得進去，沒有人讀
 *   - `notificationGroupKey()` 也沒人用，repo 裡那條 5 分鐘去重的
 *     `ON CONFLICT (recipient_id, group_key)` 形同虛設
 *
 * 這一支把三件事接在同一個出口上（`applyTransaction` commit 之後）：
 *   1. 新增的提及 → `mention` 通知（差集，見 apply-transaction 的 `diffMentions`）
 *   2. 明確追蹤（`kind = 'explicit'`）這一頁的人 → `page_updated` 通知
 *   3. 編輯者自己 → `auto` 訂閱（原本只有留言會 touch）
 *
 * 防洗版有三層：
 *   a. 差集：只有「這次新出現」的提及才通知
 *   b. 行程內節流：同一 (頁, 編輯者) 5 分鐘內只跑一次 2/3（避免每個 keystroke 一次查詢）
 *   c. `groupKey`：真的寫進資料庫時再由 `uq_notif_group` 去重一次（跨行程也成立）
 */
import { notificationGroupKey, NOTIFICATION_GROUP_WINDOW_MS } from '@kennote/shared-types';
import { logger } from '../../lib/logger.js';
import { setTransactionNotifier, type MentionDiff } from '../blocks/apply-transaction.js';
import { resolvePagePermission } from '../permissions/service.js';
import { listPageSubscribers, notify, pageTitleOf, touchSubscription } from './service.js';

/** 行程內節流：`${pageId}:${actorId}` → 上次扇出的時間 */
const lastFanOut = new Map<string, number>();
const MAX_THROTTLE_ENTRIES = 5000;

function shouldFanOutUpdate(pageId: string, actorId: string, now = Date.now()): boolean {
  const key = `${pageId}:${actorId}`;
  const prev = lastFanOut.get(key);
  if (prev !== undefined && now - prev < NOTIFICATION_GROUP_WINDOW_MS) return false;
  if (lastFanOut.size > MAX_THROTTLE_ENTRIES) lastFanOut.clear();
  lastFanOut.set(key, now);
  return true;
}

/** 測試用：清掉節流狀態 */
export function resetFanOutThrottle(): void {
  lastFanOut.clear();
}

/**
 * block 裡的新增提及 → `mention` 通知。
 * 與留言的扇出同一條紅線：**被 @ 的人沒有這一頁的讀取權限就不通知**
 * （否則可以靠 @ 探測私密頁面的存在）。
 */
export async function fanOutBlockMentions(input: {
  workspaceId: string;
  pageId: string;
  actorId: string;
  mentions: MentionDiff[];
}): Promise<number> {
  if (input.mentions.length === 0) return 0;

  // 同一個 transaction 裡同一個人被 @ 好幾次 → 只留第一次（用最先出現的片段）
  const first = new Map<string, MentionDiff>();
  for (const diff of input.mentions) {
    for (const userId of diff.added) {
      if (userId === input.actorId) continue;
      if (!first.has(userId)) first.set(userId, diff);
    }
  }
  if (first.size === 0) return 0;

  const pageTitle = await pageTitleOf(input.pageId);
  let created = 0;
  for (const [recipientId, diff] of first) {
    const permission = await resolvePagePermission(recipientId, input.pageId);
    if (permission === 'none') continue;
    const n = await notify({
      workspaceId: input.workspaceId,
      recipientId,
      actorId: input.actorId,
      type: 'mention',
      pageId: input.pageId,
      blockId: diff.blockId,
      payload: { pageTitle, snippet: diff.snippet },
      // 同一個 block 的提及 5 分鐘內只留一則（編輯 → 刪掉 → 再打一次也不會洗版）
      groupKey: notificationGroupKey('mention', `${input.pageId}:${diff.blockId}`),
    });
    if (n) created += 1;
  }
  return created;
}

/**
 * 明確追蹤這一頁的人 → `page_updated`。
 * 刻意**只通知 `explicit`**：`auto` 是「編輯 / 留言過就自動加」，
 * 拿來發編輯通知等於每個協作者都被洗版（01 §6 M5.3.3 的通知風暴警告）。
 */
export async function fanOutPageUpdated(input: {
  workspaceId: string;
  pageId: string;
  actorId: string;
}): Promise<number> {
  const subscribers = await listPageSubscribers(input.pageId, ['explicit']);
  const recipients = subscribers.filter((id) => id !== input.actorId);
  if (recipients.length === 0) return 0;

  const pageTitle = await pageTitleOf(input.pageId);
  let created = 0;
  for (const recipientId of recipients) {
    const permission = await resolvePagePermission(recipientId, input.pageId);
    if (permission === 'none') continue;
    const n = await notify({
      workspaceId: input.workspaceId,
      recipientId,
      actorId: input.actorId,
      type: 'page_updated',
      pageId: input.pageId,
      payload: { pageTitle },
      groupKey: notificationGroupKey('page_updated', input.pageId),
    });
    if (n) created += 1;
  }
  return created;
}

/** 頁面被直接分享給某個人 → `page_shared`（permissions/service 呼叫） */
export async function notifyPageShared(input: {
  workspaceId: string;
  pageId: string;
  actorId: string;
  recipientId: string;
  role: string;
}): Promise<void> {
  if (input.recipientId === input.actorId) return;
  const pageTitle = await pageTitleOf(input.pageId);
  await notify({
    workspaceId: input.workspaceId,
    recipientId: input.recipientId,
    actorId: input.actorId,
    type: 'page_shared',
    pageId: input.pageId,
    payload: { pageTitle, role: input.role },
    // 權限被連改好幾次（reader → editor → reader）只留第一則
    groupKey: notificationGroupKey('page_shared', input.pageId),
  });
}

/** 被加進工作區 → `invite`（已經有帳號的人才收得到；純 email 邀請走信件） */
export async function notifyWorkspaceInvite(input: {
  workspaceId: string;
  actorId: string;
  recipientId: string;
  role: string;
  workspaceName?: string;
}): Promise<void> {
  if (input.recipientId === input.actorId) return;
  await notify({
    workspaceId: input.workspaceId,
    recipientId: input.recipientId,
    actorId: input.actorId,
    type: 'invite',
    payload: {
      role: input.role,
      ...(input.workspaceName ? { workspaceName: input.workspaceName } : {}),
    },
    groupKey: notificationGroupKey('invite', input.workspaceId),
  });
}

/** 由 realtime/index.ts 在啟動時接上（與 registerPermissionGuard 同一個位置） */
export function registerTransactionNotifier(): void {
  setTransactionNotifier(({ ctx, workspaceId, mentions }) => {
    void (async () => {
      await fanOutBlockMentions({
        workspaceId,
        pageId: ctx.pageId,
        actorId: ctx.userId,
        mentions,
      });
      if (!shouldFanOutUpdate(ctx.pageId, ctx.userId)) return;
      await touchSubscription(ctx.userId, ctx.pageId);
      await fanOutPageUpdated({ workspaceId, pageId: ctx.pageId, actorId: ctx.userId });
    })().catch((err) => logger.warn({ err }, '編輯通知扇出失敗'));
  });
}
