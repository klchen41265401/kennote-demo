/**
 * 權限模型與分享（03 §4.12、04 §8 M5-11/12）。
 *
 * 兩層：
 *   1. workspace 角色（owner/admin/member/guest）—— 這是**上限**
 *   2. page_permissions 頁面層覆寫 + 沿父頁面鏈繼承（遇到 inherits=false 就停）
 * 有效權限 = min(工作區上限, 繼承鏈上取到的最大值)，管理員直通 full。
 */
import type { WorkspaceRole } from './auth.js';
import type { PublicUser } from './page.js';
import type { PagePermission } from './ws.js';

export type { PagePermission } from './ws.js';

/** 資料庫 page_role enum（0004_files_favorites.sql）↔ 對外的 PagePermission */
export type PageRoleRow = 'owner' | 'editor' | 'commenter' | 'reader' | 'none';

export const PAGE_ROLE_TO_PERMISSION: Record<PageRoleRow, PagePermission> = {
  owner: 'full',
  editor: 'edit',
  commenter: 'comment',
  reader: 'read',
  none: 'none',
};

export const PERMISSION_TO_PAGE_ROLE: Record<PagePermission, PageRoleRow> = {
  full: 'owner',
  edit: 'editor',
  comment: 'commenter',
  read: 'reader',
  none: 'none',
};

/** 工作區角色能拿到的最高頁面權限（guest 封頂在 comment） */
export const WORKSPACE_ROLE_CEILING: Record<WorkspaceRole, PagePermission> = {
  owner: 'full',
  admin: 'full',
  member: 'full',
  guest: 'comment',
};

/** 工作區角色在「沒有任何 page_permissions 條目」時的預設權限 */
export const WORKSPACE_ROLE_BASELINE: Record<WorkspaceRole, PagePermission> = {
  owner: 'full',
  admin: 'full',
  member: 'edit',
  /** guest 預設看不到任何頁面，必須被明確授權 */
  guest: 'none',
};

export interface PagePermissionEntry {
  id: string;
  pageId: string;
  subjectType: 'user' | 'workspace' | 'public';
  subjectId: string | null;
  role: PageRoleRow;
  permission: PagePermission;
  /** 這筆是從哪一層繼承來的（0 = 這一頁自己） */
  inheritedFromPageId?: string | null;
  user?: PublicUser;
}

export interface PageAccessResponse {
  pageId: string;
  /** 我自己的有效權限 */
  permission: PagePermission;
  inheritsPermissions: boolean;
  entries: PagePermissionEntry[];
  publicLink: PublicLinkInfo | null;
}

export interface SetPagePermissionRequest {
  subjectType: 'user' | 'workspace';
  subjectId?: string | null;
  /** 'none' = 移除這筆授權 */
  permission: PagePermission;
}

/* ── 公開分享連結 ─────────────────────────────────────── */

export interface PublicLinkInfo {
  token: string;
  url: string;
  hasPassword: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateShareRequest {
  enabled: boolean;
  password?: string | null;
  /** ISO 時間字串；null = 不過期 */
  expiresAt?: string | null;
}

/* ── 成員管理 ─────────────────────────────────────────── */

export interface InviteMemberRequest {
  email: string;
  role?: Exclude<WorkspaceRole, 'owner'>;
}

export interface InviteMemberResponse {
  /** 使用者已存在 → 直接加入；否則建立邀請 token */
  status: 'joined' | 'invited';
  member?: { userId: string; role: WorkspaceRole; user: PublicUser };
  invite?: { id: string; email: string; role: WorkspaceRole; token: string; expiresAt: string };
}

export interface UpdateMemberRoleRequest {
  role: WorkspaceRole;
}

/* ── M5 端點總表 ──────────────────────────────────────────
 * api.ts 的 API_ROUTES 由 M1 建立且被多個模組共用；M5 新增的端點集中放這裡，
 * 前端 import { COLLAB_API_ROUTES } 使用，避免多個代理同時改同一張表。
 */
export const COLLAB_API_ROUTES = {
  pageDiscussions: (pageId: string) => `/api/pages/${pageId}/discussions`,
  discussion: (discussionId: string) => `/api/discussions/${discussionId}`,
  discussionComments: (discussionId: string) => `/api/discussions/${discussionId}/comments`,
  discussionResolve: (discussionId: string) => `/api/discussions/${discussionId}/resolve`,
  comment: (commentId: string) => `/api/comments/${commentId}`,

  notifications: '/api/notifications',
  notificationRead: (id: string) => `/api/notifications/${id}/read`,
  notificationsReadAll: '/api/notifications/read-all',

  pageAccess: (pageId: string) => `/api/pages/${pageId}/permissions`,
  pageShare: (pageId: string) => `/api/pages/${pageId}/share`,
  publicPage: (token: string) => `/api/public/${token}`,

  workspaceInvites: (workspaceId: string) => `/api/workspaces/${workspaceId}/invites`,
  workspaceMember: (workspaceId: string, userId: string) =>
    `/api/workspaces/${workspaceId}/members/${userId}`,

  pageHistory: (pageId: string) => `/api/pages/${pageId}/history`,
  pageHistoryAt: (pageId: string, seq: number) => `/api/pages/${pageId}/history/${seq}`,
  pageHistoryRestore: (pageId: string, seq: number) =>
    `/api/pages/${pageId}/history/${seq}/restore`,

  /** 「更新」feed（活動摘要），與 pageHistory（快照清單）是兩個不同的東西 */
  pageUpdates: (pageId: string, cursor?: string | null) =>
    `/api/pages/${pageId}/updates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
  /** 首頁側邊欄「留言」：跨頁最近留言（gap-review C-8） */
  workspaceDiscussions: (workspaceId: string) =>
    `/api/workspaces/${workspaceId}/discussions`,
} as const;
