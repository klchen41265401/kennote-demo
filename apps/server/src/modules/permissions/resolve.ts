/**
 * 權限解析的**純邏輯**（03 §4.12 的繼承規則）。
 * 刻意不碰資料庫，才能單獨測試每一條規則（apps/server/test/permissions.test.ts）。
 *
 * 規則（嚴格照 03 §4.12）：
 *   1. 從目標頁面往上爬祖先鏈，遇到第一個 inherits_permissions = false 就停
 *   2. 沿途收集所有 page_permissions 條目
 *   3. 挑出適用於此使用者的：subject_type='user' AND subject_id=me
 *      或 subject_type='workspace'（使用者非 guest 時適用）
 *   4. 取最大值；沒有任何條目 → 用工作區角色的 baseline
 *   5. 最後與工作區角色的上限取 min（guest 封頂在 comment；admin/owner 直通 full）
 *
 * 補充（本專案的決定）：**depth 較淺（離目標頁面較近）不會覆蓋較深的**，
 * 一律取最大值。理由：Notion 的心智模型是「授權只會加、不會減」，
 * 要減必須按「停止繼承」，那已經由規則 1 的中斷點表達。
 */
import type { PageRoleRow, PagePermission, WorkspaceRole } from '@kennote/shared-types';
import {
  PAGE_PERMISSION_RANK,
  PAGE_ROLE_TO_PERMISSION,
  WORKSPACE_ROLE_BASELINE,
  WORKSPACE_ROLE_CEILING,
} from '@kennote/shared-types';

export interface PermissionEntryInput {
  subjectType: 'user' | 'workspace' | 'public';
  subjectId: string | null;
  role: PageRoleRow;
  /** 0 = 目標頁面自己，1 = 父頁面… */
  depth: number;
}

export interface ResolveInput {
  userId: string;
  /** null = 不是這個工作區的成員 */
  workspaceRole: WorkspaceRole | null;
  /** 已經沿繼承鏈收集好的條目（中斷點以上的不應該出現在這裡） */
  entries: PermissionEntryInput[];
  /** 這一頁是否已透過公開連結分享（匿名訪客走 resolvePublicPermission） */
  isPageOwner?: boolean;
}

export function maxPermission(a: PagePermission, b: PagePermission): PagePermission {
  return PAGE_PERMISSION_RANK[a] >= PAGE_PERMISSION_RANK[b] ? a : b;
}

export function minPermission(a: PagePermission, b: PagePermission): PagePermission {
  return PAGE_PERMISSION_RANK[a] <= PAGE_PERMISSION_RANK[b] ? a : b;
}

export function resolvePermission(input: ResolveInput): PagePermission {
  const { userId, workspaceRole, entries } = input;

  // 不是成員 → 一律看不到（呼叫端會轉成 404，不洩漏存在性）
  if (!workspaceRole) return 'none';

  // 管理員直通（03 §4.12 effective_page_role 的 IF v_ws_role IN ('owner','admin')）
  if (workspaceRole === 'owner' || workspaceRole === 'admin') return 'full';

  // 頁面建立者視同 full（本專案補充：否則自己建的頁面會被別人的條目綁住）
  if (input.isPageOwner) return 'full';

  const applicable = entries.filter((e) => {
    if (e.subjectType === 'user') return e.subjectId === userId;
    if (e.subjectType === 'workspace') return workspaceRole !== 'guest';
    return false; // public 條目只對匿名訪客有意義
  });

  let granted: PagePermission =
    applicable.length > 0 ? 'none' : WORKSPACE_ROLE_BASELINE[workspaceRole];

  for (const entry of applicable) {
    granted = maxPermission(granted, PAGE_ROLE_TO_PERMISSION[entry.role]);
  }

  return minPermission(granted, WORKSPACE_ROLE_CEILING[workspaceRole]);
}

/** 公開連結（匿名）能拿到什麼：目前固定唯讀，密碼與到期由呼叫端先驗過 */
export function resolvePublicPermission(entries: PermissionEntryInput[]): PagePermission {
  let granted: PagePermission = 'none';
  for (const e of entries) {
    if (e.subjectType !== 'public') continue;
    granted = maxPermission(granted, PAGE_ROLE_TO_PERMISSION[e.role]);
  }
  // 公開連結**永遠**不給寫入權，即使條目寫了 editor（04 §5.6 的最小權限原則）
  return minPermission(granted, 'read');
}
