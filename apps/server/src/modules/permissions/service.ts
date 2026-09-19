/**
 * 權限服務。**這一層不認識 HTTP / WS**（04 §7.3 鐵則 1）：
 * REST route、WebSocket handler、applyTransaction 的守門員都呼叫同一組函式。
 *
 * 對外最重要的就一支：
 *   resolvePagePermission(userId, pageId) → 'full' | 'edit' | 'comment' | 'read' | 'none'
 *
 * 驗收標準（04 §8 M5）：**Guest 只能留言不能編輯，後端要拒絕。**
 * 所以寫入路徑一律經過 requirePagePermission(..., 'edit')，
 * 而 applyTransaction 在 M5 被裝上 permission guard（見 registerPermissionGuard）。
 */
import { randomBytes } from 'node:crypto';
import type {
  PageAccessResponse,
  PagePermission,
  PagePermissionEntry,
  PublicLinkInfo,
  PublicUser,
  WorkspaceRole,
} from '@kennote/shared-types';
import { PAGE_ROLE_TO_PERMISSION, PERMISSION_TO_PAGE_ROLE } from '@kennote/shared-types';
import { db, withTransaction, type Queryable } from '../../db/client.js';
import { env } from '../../env.js';
import { AppError, pageNotFound, workspaceNotFound } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { setPermissionGuard } from '../blocks/apply-transaction.js';
import {
  notifyPageShared,
  notifyPermissionChanged,
  notifyWorkspaceInvite,
} from '../notifications/fanout.js';
import * as repo from './repo.js';
import { resolvePermission, resolvePublicPermission } from './resolve.js';

/* ── 撤權事件（第七輪 §4-4 / 第八輪 §4-3） ─────────────── */

/**
 * ⭐ **REST 的權限檢查管不到已經連上的 WebSocket。**
 *
 * 第七、八輪把每一支 REST 端點都鎖上了，但房間只認「subscribe 當下算過的那一次」——
 * 撤權之後那條連線照樣收 `txBroadcast`（= 頁面內容持續外流）。
 *
 * 這裡只是**發事件**：權限服務不認識 WS（04 §7.3 鐵則 1），
 * 由 `realtime/index.ts` 把它接到 `RoomManager.publishPermissionChanged()`，
 * 房間再重新 `resolvePagePermission()` 決定踢人還是降級。
 * 預設 no-op —— CLI / 測試沒有 realtime 也要跑得起來。
 */
export type PermissionChangeNotifier = (target: {
  userId?: string | null;
  pageId?: string | null;
}) => void;

let permissionChangeNotifier: PermissionChangeNotifier = () => {};

export function setPermissionChangeNotifier(fn: PermissionChangeNotifier | null): void {
  permissionChangeNotifier = fn ?? (() => {});
}

/** 失敗不能影響授權本身：撤權要先成功，通知房間是後續動作 */
function emitPermissionChange(target: { userId?: string | null; pageId?: string | null }): void {
  try {
    permissionChangeNotifier(target);
  } catch {
    /* 廣播失敗不影響授權結果 */
  }
}

/* ── 解析 ─────────────────────────────────────────────── */

export async function resolvePagePermission(
  userId: string,
  pageId: string,
  conn: Queryable = db,
): Promise<PagePermission> {
  const page = await repo.findPageMeta(pageId, conn);
  if (!page || page.deleted_at !== null) return 'none';

  const workspaceRole = await repo.getWorkspaceRole(page.workspace_id, userId, conn);
  // 第六輪：`workspaceRole === null`（工作區外的被授權者）也往下走 ——
  // `resolvePermission()` 會只認直接指名他的 `user` 條目，並封頂在 `edit`。
  if (workspaceRole === 'owner' || workspaceRole === 'admin') return 'full';

  const entries = await repo.collectInheritedEntries(pageId, conn);
  return resolvePermission({
    userId,
    workspaceRole,
    entries,
    // 非成員不適用「建立者視同 full」：他本來就不可能是建立者
    isPageOwner: workspaceRole !== null && page.created_by === userId,
  });
}

/**
 * 沒權限時怎麼回？
 *   完全看不到（none）→ 404，不洩漏頁面存在性（00-README 第一週驗收標準）
 *   看得到但不夠 → 403 FORBIDDEN
 */
export async function requirePagePermission(
  userId: string,
  pageId: string,
  need: PagePermission,
  conn: Queryable = db,
): Promise<PagePermission> {
  const have = await resolvePagePermission(userId, pageId, conn);
  if (have === 'none') throw pageNotFound();
  const rank = { none: 0, read: 1, comment: 2, edit: 3, full: 4 };
  if (rank[have] < rank[need]) {
    throw new AppError('FORBIDDEN', permissionMessage(need), { pageId, have, need });
  }
  return have;
}

/**
 * ⭐ 垃圾桶裡的頁面**不能**用 `requirePagePermission()` 判斷。
 *
 * `resolvePagePermission()` 開頭就是 `if (!page || page.deleted_at !== null) return 'none'`，
 * 所以已刪除的頁面對**任何人**（含擁有者）都是 `none` → 直接套上去會讓擁有者
 * 連自己的東西都還原不了。第五輪 BUG-27 因此刻意跳過 `permanentlyDeletePage`，
 * 結果留下一個更糟的洞（第六輪 BUG-29）：
 * `findPageInUserWorkspace()` 只 JOIN `workspace_members`，於是**任何工作區成員（含 guest）
 * 都能永久刪掉別人的頁面** —— 而且是 hard delete，沒有回頭路。
 *
 * 已刪除的頁面沒有「現在的權限」可言，改問「誰有資格處置這份殘骸」：
 *   1. 工作區 owner / admin
 *   2. 頁面的建立者（`created_by`）
 *   3. 把它丟進垃圾桶的人（軟刪除時 `updated_by` 會被設成操作者）
 *
 * 其他人 → 403；完全不是工作區成員 → 404（不洩漏頁面存在性）。
 */
export async function requireTrashedPageControl(
  userId: string,
  pageId: string,
  conn: Queryable = db,
): Promise<repo.TrashedPageMetaRow> {
  const page = await repo.findPageMetaWithActor(pageId, conn);
  if (!page) throw pageNotFound();

  const workspaceRole = await repo.getWorkspaceRole(page.workspace_id, userId, conn);
  if (!workspaceRole) throw pageNotFound();

  if (canControlTrashedPage(userId, workspaceRole, page)) return page;
  throw new AppError('FORBIDDEN', '只有頁面的建立者、刪除者或工作區管理員可以處置垃圾桶裡的頁面', {
    pageId,
  });
}

/** 純判斷，`emptyTrash()` 要逐頁篩選時共用（也方便單元測試） */
export function canControlTrashedPage(
  userId: string,
  workspaceRole: WorkspaceRole,
  page: { created_by: string | null; updated_by: string | null },
): boolean {
  if (workspaceRole === 'owner' || workspaceRole === 'admin') return true;
  return page.created_by === userId || page.updated_by === userId;
}

function permissionMessage(need: PagePermission): string {
  switch (need) {
    case 'edit':
      return '你對這個頁面只有留言或檢視權限，無法編輯';
    case 'comment':
      return '你對這個頁面沒有留言權限';
    case 'full':
      return '只有頁面管理者可以執行這個操作';
    default:
      return '沒有權限執行這個操作';
  }
}

export async function requireWorkspaceRole(
  workspaceId: string,
  userId: string,
  allowed: WorkspaceRole[],
): Promise<WorkspaceRole> {
  const role = await repo.getWorkspaceRole(workspaceId, userId);
  if (!role) throw workspaceNotFound();
  if (!allowed.includes(role)) {
    throw new AppError('FORBIDDEN', '只有工作區管理員可以執行這個操作');
  }
  return role;
}

/**
 * ⭐ 把權限檢查裝進 applyTransaction —— 所有 block 寫入（HTTP / WS / 內部呼叫）
 * 都會經過這裡，guest 或只有 read/comment 權限的人一律被擋下。
 */
export function registerPermissionGuard(): void {
  setPermissionGuard(async (ctx, conn) => {
    // 頁面建立時的第一個 paragraph 也走 applyTransaction；那時使用者必是建立者
    await requirePagePermission(ctx.userId, ctx.pageId, 'edit', conn);
  });
}

/* ── 頁面授權列表（分享面板） ──────────────────────────── */

function toPublicUser(row: {
  subject_id: string | null;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
}): PublicUser | undefined {
  if (!row.subject_id || row.name === null) return undefined;
  return {
    id: row.subject_id,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatar_url,
  };
}

export async function getPageAccess(pageId: string, userId: string): Promise<PageAccessResponse> {
  const permission = await requirePagePermission(userId, pageId, 'read');
  const page = await repo.findPageMeta(pageId);
  if (!page) throw pageNotFound();

  const rows = await repo.listPageEntries(pageId);
  const entries: PagePermissionEntry[] = rows.map((r) => {
    const user = toPublicUser(r);
    return {
      id: r.id,
      pageId: r.page_id,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      role: r.role,
      permission: PAGE_ROLE_TO_PERMISSION[r.role],
      inheritedFromPageId: null,
      ...(user ? { user } : {}),
    };
  });

  const link = await repo.findActiveLinkByPage(pageId);
  return {
    pageId,
    permission,
    inheritsPermissions: page.inherits_permissions,
    entries,
    publicLink: link ? toPublicLinkInfo(link) : null,
  };
}

export async function setPagePermission(
  pageId: string,
  actorId: string,
  input: {
    subjectType: 'user' | 'workspace';
    subjectId?: string | null;
    permission: PagePermission;
  },
): Promise<PageAccessResponse> {
  await requirePagePermission(actorId, pageId, 'full');
  const page = await repo.findPageMeta(pageId);
  if (!page) throw pageNotFound();

  const subjectId = input.subjectType === 'user' ? (input.subjectId ?? null) : null;
  if (input.subjectType === 'user' && !subjectId) {
    throw new AppError('VALIDATION_FAILED', '缺少 subjectId');
  }
  // workspace 主體在 0004 的 CHECK 下需要 subject_id（= workspaceId）
  const storedSubjectId = input.subjectType === 'workspace' ? page.workspace_id : subjectId;

  // 寫入之前先看有沒有舊條目：有 → 這是「變更」，沒有 → 這是「第一次分享」。
  // 兩者的通知型別不同（permission_changed / page_shared），只能在寫入前分辨。
  const existingEntries = await repo.listPageEntries(pageId);
  const previous = existingEntries.find(
    (e) => e.subject_type === input.subjectType && e.subject_id === storedSubjectId,
  );

  await withTransaction(async (tx) => {
    if (input.permission === 'none') {
      await repo.deletePageEntry(tx, pageId, input.subjectType, storedSubjectId);
    } else {
      await repo.upsertPageEntry(tx, {
        workspaceId: page.workspace_id,
        pageId,
        subjectType: input.subjectType,
        subjectId: storedSubjectId,
        role: PERMISSION_TO_PAGE_ROLE[input.permission],
        grantedBy: actorId,
      });
    }
  });

  /*
   * 第七輪（第六輪 §5-6）：7 種通知型別裡只有 3 種產得出來。
   * 「頁面被分享給你」是使用者最有感的一種 —— 沒有它，被分享的人
   * 只能等別人把網址貼過來。失敗不影響授權本身（fire-and-forget）。
   */
  if (input.subjectType === 'user' && subjectId) {
    /*
     * 第九輪：7 種通知型別的**最後一種**（`permission_changed`）終於有發送端。
     *   沒有舊條目 + 給權限 → `page_shared`（「有人把一頁分享給你」，第七輪接的）
     *   有舊條目（升級 / 降級）或撤銷（`none`）→ `permission_changed`
     * 兩者互斥，所以改權限不會同時收到兩則。
     */
    if (!previous && input.permission !== 'none') {
      void notifyPageShared({
        workspaceId: page.workspace_id,
        pageId,
        actorId,
        recipientId: subjectId,
        role: PERMISSION_TO_PAGE_ROLE[input.permission],
      }).catch(() => {});
    } else if (previous) {
      void notifyPermissionChanged({
        workspaceId: page.workspace_id,
        pageId,
        actorId,
        recipientId: subjectId,
        permission: input.permission,
        previousPermission: PAGE_ROLE_TO_PERMISSION[previous.role],
      }).catch(() => {});
    }
  }

  // 已經連上的 WS 連線要立刻重新算權限（撤權 → 踢出房間；降級 → 切唯讀）
  if (input.subjectType === 'user' && subjectId) {
    emitPermissionChange({ userId: subjectId, pageId: null });
  } else {
    // workspace 條目影響**房間裡的每一個人**，逐人重算
    emitPermissionChange({ pageId });
  }

  return getPageAccess(pageId, actorId);
}

/* ── 公開分享連結（04 §8 M5-12） ───────────────────────── */

function toPublicLinkInfo(row: repo.PublicLinkRow): PublicLinkInfo {
  return {
    token: row.token,
    url: `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/public/${row.token}`,
    hasPassword: row.password_hash !== null,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function setPageShare(
  pageId: string,
  actorId: string,
  input: { enabled: boolean; password?: string | null; expiresAt?: string | null },
): Promise<PublicLinkInfo | null> {
  if (!env.FEATURE_PUBLIC_SHARE) {
    throw new AppError('NOT_IMPLEMENTED', '公開分享功能尚未啟用（FEATURE_PUBLIC_SHARE）');
  }
  await requirePagePermission(actorId, pageId, 'full');
  const page = await repo.findPageMeta(pageId);
  if (!page) throw pageNotFound();

  if (!input.enabled) {
    await withTransaction(async (tx) => {
      await repo.revokePublicLink(tx, pageId);
      await repo.deletePageEntry(tx, pageId, 'public', null);
    });
    // 關閉公開分享 = 撤權，房間裡的人要重算一次
    emitPermissionChange({ pageId });
    return null;
  }

  const existing = await repo.findActiveLinkByPage(pageId);
  const token = existing?.token ?? randomBytes(18).toString('base64url');
  let passwordHash: string | null = existing?.password_hash ?? null;
  if (input.password === null) passwordHash = null;
  else if (typeof input.password === 'string' && input.password.length > 0) {
    passwordHash = await hashPassword(input.password);
  }

  const row = await withTransaction(async (tx) => {
    const link = await repo.upsertPublicLink(tx, {
      workspaceId: page.workspace_id,
      pageId,
      token,
      passwordHash,
      expiresAt: input.expiresAt ?? null,
      createdBy: actorId,
    });
    // 公開條目讓權限解析看得到「這一頁是公開的」
    await repo.upsertPageEntry(tx, {
      workspaceId: page.workspace_id,
      pageId,
      subjectType: 'public',
      subjectId: null,
      role: 'reader',
      grantedBy: actorId,
    });
    return link;
  });

  return toPublicLinkInfo(row);
}

export interface PublicAccess {
  pageId: string;
  workspaceId: string;
  permission: PagePermission;
}

/** 匿名訪客：token → 頁面。密碼錯 / 過期 / 撤銷一律當作找不到 */
export async function resolvePublicAccess(
  token: string,
  password?: string | null,
): Promise<PublicAccess> {
  if (!env.FEATURE_PUBLIC_SHARE) throw new AppError('NOT_FOUND');
  const link = await repo.findActiveLinkByToken(token);
  if (!link) throw new AppError('NOT_FOUND');
  if (link.expires_at && link.expires_at.getTime() < Date.now()) {
    throw new AppError('NOT_FOUND', '這個分享連結已經過期');
  }
  if (link.password_hash) {
    if (!password) throw new AppError('UNAUTHORIZED', '這個分享連結需要密碼');
    if (!(await verifyPassword(link.password_hash, password))) {
      throw new AppError('UNAUTHORIZED', '密碼不正確');
    }
  }
  const page = await repo.findPageMeta(link.page_id);
  if (!page || page.deleted_at !== null) throw new AppError('NOT_FOUND');

  const entries = await repo.collectInheritedEntries(link.page_id);
  const permission = resolvePublicPermission(entries);
  if (permission === 'none') throw new AppError('NOT_FOUND');

  return { pageId: link.page_id, workspaceId: page.workspace_id, permission };
}

/* ── 工作區成員 ───────────────────────────────────────── */

export async function inviteMember(
  workspaceId: string,
  actorId: string,
  input: { email: string; role?: Exclude<WorkspaceRole, 'owner'> },
): Promise<{
  status: 'joined' | 'invited';
  member?: { userId: string; role: WorkspaceRole; user: PublicUser };
  invite?: { id: string; email: string; role: WorkspaceRole; token: string; expiresAt: string };
}> {
  await requireWorkspaceRole(workspaceId, actorId, ['owner', 'admin']);
  const role: WorkspaceRole = input.role ?? 'member';
  const email = input.email.trim().toLowerCase();

  const existing = await repo.findUserByEmail(email);
  if (existing) {
    await withTransaction((tx) =>
      repo.addMember(tx, { workspaceId, userId: existing.id, role, invitedBy: actorId }),
    );
    // 第七輪：`invite` 通知（已經有帳號的人直接加入工作區，不會收到任何信）
    void notifyWorkspaceInvite({
      workspaceId,
      actorId,
      recipientId: existing.id,
      role,
    }).catch(() => {});
    return {
      status: 'joined',
      member: {
        userId: existing.id,
        role,
        user: {
          id: existing.id,
          name: existing.name,
          email: existing.email,
          avatarUrl: existing.avatar_url,
        },
      },
    };
  }

  const token = randomBytes(24).toString('base64url');
  const invite = await withTransaction((tx) =>
    repo.createInvite(tx, { workspaceId, email, role, token, invitedBy: actorId }),
  );
  return {
    status: 'invited',
    invite: {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token: invite.token,
      expiresAt: invite.expires_at.toISOString(),
    },
  };
}

export async function changeMemberRole(
  workspaceId: string,
  actorId: string,
  targetUserId: string,
  role: WorkspaceRole,
): Promise<{ userId: string; role: WorkspaceRole }> {
  const actorRole = await requireWorkspaceRole(workspaceId, actorId, ['owner', 'admin']);
  if (role === 'owner' && actorRole !== 'owner') {
    throw new AppError('FORBIDDEN', '只有工作區擁有者可以指派新的擁有者');
  }
  const targetRole = await repo.getWorkspaceRole(workspaceId, targetUserId);
  if (!targetRole) throw new AppError('NOT_FOUND', '這個人不是工作區成員');
  if (targetRole === 'owner' && actorRole !== 'owner') {
    throw new AppError('FORBIDDEN', '不能更改工作區擁有者的角色');
  }
  const ok = await withTransaction((tx) =>
    repo.updateMemberRole(tx, workspaceId, targetUserId, role),
  );
  if (!ok) throw new AppError('NOT_FOUND', '這個人不是工作區成員');
  // 工作區角色是每一頁權限的 baseline / ceiling → 這個人**所有**訂閱中的頁面都要重算
  emitPermissionChange({ userId: targetUserId, pageId: null });
  return { userId: targetUserId, role };
}

export async function removeMember(
  workspaceId: string,
  actorId: string,
  targetUserId: string,
): Promise<{ removed: string }> {
  await requireWorkspaceRole(workspaceId, actorId, ['owner', 'admin']);
  const targetRole = await repo.getWorkspaceRole(workspaceId, targetUserId);
  if (targetRole === 'owner') {
    throw new AppError('FORBIDDEN', '不能移除工作區擁有者');
  }
  const ok = await withTransaction((tx) => repo.removeMember(tx, workspaceId, targetUserId));
  if (!ok) throw new AppError('NOT_FOUND', '這個人不是工作區成員');
  // 被踢出工作區 = 對這個工作區的每一頁都變成 none（除非另有直接授權）
  emitPermissionChange({ userId: targetUserId, pageId: null });
  return { removed: targetUserId };
}
