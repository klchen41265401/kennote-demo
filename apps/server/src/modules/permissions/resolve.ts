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

/**
 * 第七輪：把「沿繼承鏈收集到的條目」壓成一個**可合併的摘要**（fold）。
 *
 * 為什麼要拆出來：側邊欄頁面樹 / 垃圾桶 / 最近 / 收藏都要對**每一頁**問權限，
 * 一頁一次 `resolvePagePermission()` 等於 N × 2 次查詢（1000 頁 = 2000 次往返）。
 * fold 是結合律的（`combineFolds`），所以「這一頁的條目」＋「父頁的 fold」
 * 就是「這一頁的 fold」——整棵樹一次 O(N) 折完（見 permissions/bulk.ts）。
 *
 * `resolvePermission()` 自己也走同一條路（fold → resolveFold），
 * 單頁與批次因此**不可能算出不同答案**。
 */
export interface ChainFold {
  /** 這條鏈上有沒有「適用於這個使用者」的條目（有 → 不套 baseline） */
  hasApplicable: boolean;
  /** 適用條目的最大值 */
  max: PagePermission;
}

export const EMPTY_FOLD: ChainFold = { hasApplicable: false, max: 'none' };

/** 哪些條目「適用於這個使用者」——與 03 §4.12 的 effective_page_role 同一組規則 */
export function entryApplies(
  entry: PermissionEntryInput,
  userId: string,
  workspaceRole: WorkspaceRole | null,
): boolean {
  if (entry.subjectType === 'user') return entry.subjectId === userId;
  // 非成員：只認直接指名他的 user 條目（見下方 resolveFold 的說明）
  if (workspaceRole === null) return false;
  if (entry.subjectType === 'workspace') return workspaceRole !== 'guest';
  return false; // public 條目只對匿名訪客有意義
}

export function foldEntries(
  userId: string,
  workspaceRole: WorkspaceRole | null,
  entries: PermissionEntryInput[],
): ChainFold {
  let fold = EMPTY_FOLD;
  for (const e of entries) {
    if (!entryApplies(e, userId, workspaceRole)) continue;
    fold = {
      hasApplicable: true,
      max: maxPermission(fold.max, PAGE_ROLE_TO_PERMISSION[e.role]),
    };
  }
  return fold;
}

/** 子頁面的 fold ⊕ 祖先的 fold（繼承中斷點由呼叫端負責不要往上合併） */
export function combineFolds(a: ChainFold, b: ChainFold): ChainFold {
  if (!b.hasApplicable) return a;
  if (!a.hasApplicable) return b;
  return { hasApplicable: true, max: maxPermission(a.max, b.max) };
}

/** fold → 最終權限（工作區角色的 baseline / ceiling 都在這裡套） */
export function resolveFold(
  workspaceRole: WorkspaceRole | null,
  fold: ChainFold,
  isPageOwner = false,
): PagePermission {
  /*
   * 第六輪：**工作區外的被授權者**（第五輪 §4-3 留下來要決定的設計）。
   *
   * 原本這裡是 `if (!workspaceRole) return 'none'` ——
   * 只寫頁面層級授權、沒把人加進工作區時，對方連 `GET /snapshot` 都 404。
   * 結果是分享彈窗只好在邀請時把人**塞進整個工作區當 member**
   * （baseline = 對每一頁都 edit），「只想給他看這一頁」做不到。
   *
   * 決定：非成員也能被頁面層級授權，但**只有直接指名他的 `user` 條目算數**
   * （`entryApplies` 已經濾掉 workspace / public），而且**沒有 baseline**、
   * 封頂在 `edit`：非成員永遠拿不到 `full`，不能再分享給別人。
   */
  if (!workspaceRole) return minPermission(fold.max, 'edit');

  // 管理員直通（03 §4.12 effective_page_role 的 IF v_ws_role IN ('owner','admin')）
  if (workspaceRole === 'owner' || workspaceRole === 'admin') return 'full';

  // 頁面建立者視同 full（本專案補充：否則自己建的頁面會被別人的條目綁住）
  if (isPageOwner) return 'full';

  const granted = fold.hasApplicable ? fold.max : WORKSPACE_ROLE_BASELINE[workspaceRole];
  return minPermission(granted, WORKSPACE_ROLE_CEILING[workspaceRole]);
}

export function resolvePermission(input: ResolveInput): PagePermission {
  const fold = foldEntries(input.userId, input.workspaceRole, input.entries);
  return resolveFold(input.workspaceRole, fold, input.isPageOwner ?? false);
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
