/**
 * 第七輪：**批次頁面權限**（側邊欄頁面樹 / 垃圾桶 / 最近 / 收藏用）。
 *
 * 問題（第六輪 §5-1、§5-2）：`getWorkspaceTree()` / `listTrash()` 連 `userId`
 * 都沒收，只在 route 層驗成員身分 —— `WORKSPACE_ROLE_BASELINE.guest === 'none'`
 * 的 guest 照樣看得到**工作區裡每一頁的標題與樹狀結構**（點進去才 404）。
 * 搜尋有兩層過濾，樹與垃圾桶一層都沒有。
 *
 * 為什麼不直接對每一頁呼叫 `resolvePagePermission()`：那是 2 次查詢 × N 頁，
 * 1000 頁 = 2000 次往返。這裡改成 **≤ 3 次查詢 + 一次 O(N) 的記憶體折疊**：
 *
 *   1. `workspace_members` → 我的角色（owner/admin 直接放行，連查都不用查）
 *   2. `page_permissions`（整個工作區）→ 沒有任何條目時 member 的 baseline 就是 edit，
 *      **整個工作區直接放行**（03 §7.4 的效能陷阱，與 search/service 同一個判斷）
 *   3. `pages` 的 (id, parent_id, inherits_permissions, created_by)
 *
 * 折疊沿用 `resolve.ts` 的 `ChainFold`，所以批次與單頁 `resolvePagePermission()`
 * 走的是同一組規則，不可能算出不同答案。
 */
import type { PageRoleRow, PagePermission, WorkspaceRole } from '@kennote/shared-types';
import { WORKSPACE_ROLE_BASELINE, WORKSPACE_ROLE_CEILING } from '@kennote/shared-types';
import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';
import {
  combineFolds,
  EMPTY_FOLD,
  foldEntries,
  minPermission,
  resolveFold,
  type ChainFold,
  type PermissionEntryInput,
} from './resolve.js';

/** 繼承鏈往上爬的上限，與 repo.collectInheritedEntries 的 CTE 一致 */
const MAX_CHAIN_DEPTH = 64;

export interface PageNodeMeta {
  id: string;
  parentId: string | null;
  inheritsPermissions: boolean;
  createdBy: string | null;
}

export type PermissionIndex =
  /** 這個工作區對我整片放行（owner/admin，或沒有任何 page_permissions 條目的 member） */
  | { mode: 'all'; role: WorkspaceRole | null }
  /** 逐頁解析的結果；不在 map 裡的頁面一律 'none' */
  | { mode: 'map'; role: WorkspaceRole | null; permissions: Map<string, PagePermission> };

export function permissionOf(index: PermissionIndex, pageId: string): PagePermission {
  if (index.mode === 'all') return 'full';
  return index.permissions.get(pageId) ?? 'none';
}

export function canSee(index: PermissionIndex, pageId: string): boolean {
  return permissionOf(index, pageId) !== 'none';
}

/** 純函式版本，方便測試與量效能（不碰資料庫） */
export function buildIndexFrom(input: {
  userId: string;
  role: WorkspaceRole | null;
  nodes: PageNodeMeta[];
  entries: Array<PermissionEntryInput & { pageId: string }>;
}): Map<string, PagePermission> {
  const { userId, role, nodes, entries } = input;

  const nodeById = new Map<string, PageNodeMeta>();
  for (const n of nodes) nodeById.set(n.id, n);

  const ownEntries = new Map<string, PermissionEntryInput[]>();
  for (const e of entries) {
    const list = ownEntries.get(e.pageId);
    if (list) list.push(e);
    else ownEntries.set(e.pageId, [e]);
  }

  // 自己的條目先各自折一次（O(條目數)）
  const ownFold = new Map<string, ChainFold>();
  for (const [pageId, list] of ownEntries) {
    ownFold.set(pageId, foldEntries(userId, role, list));
  }

  // 沿祖先鏈合併，memoize → 整棵樹 O(N)
  const chainFold = new Map<string, ChainFold>();
  const foldOf = (pageId: string): ChainFold => {
    const stack: string[] = [];
    let cursor: string | null = pageId;
    let acc: ChainFold | null = null;
    let depth = 0;
    // 先往上走到「已經算過的祖先」或鏈的頂端，再回頭把沿途每一層都填進 memo
    while (cursor !== null && depth < MAX_CHAIN_DEPTH) {
      const cached = chainFold.get(cursor);
      if (cached) {
        acc = cached;
        break;
      }
      const node = nodeById.get(cursor);
      if (!node) break;
      stack.push(cursor);
      cursor = node.inheritsPermissions ? node.parentId : null;
      depth += 1;
    }
    let fold = acc ?? EMPTY_FOLD;
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const id = stack[i] as string;
      fold = combineFolds(ownFold.get(id) ?? EMPTY_FOLD, fold);
      chainFold.set(id, fold);
    }
    return fold;
  };

  const out = new Map<string, PagePermission>();
  for (const node of nodes) {
    const isPageOwner = role !== null && node.createdBy === userId;
    out.set(node.id, resolveFold(role, foldOf(node.id), isPageOwner));
  }
  return out;
}

interface EntryRow {
  page_id: string;
  subject_type: 'user' | 'workspace' | 'public';
  subject_id: string | null;
  role: PageRoleRow;
}

interface NodeRow {
  id: string;
  parent_id: string | null;
  inherits_permissions: boolean;
  created_by: string | null;
}

/**
 * 一個工作區、一個使用者的完整權限索引。
 * `includeDeleted` 給垃圾桶用（已刪除的頁面仍要算出「如果還在，你看不看得到」）。
 */
export async function buildPermissionIndex(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole | null,
  conn: Queryable = db,
): Promise<PermissionIndex> {
  if (role === 'owner' || role === 'admin') return { mode: 'all', role };

  const entryRows = await conn.query<EntryRow>(sql`
    SELECT page_id, subject_type::text AS subject_type, subject_id, role::text AS role
      FROM page_permissions
     WHERE workspace_id = ${workspaceId}
  `);

  if (entryRows.length === 0) {
    // 沒有任何頁面層級條目 → 每一頁都是 baseline（member = edit、guest = none）
    if (role === null) return { mode: 'map', role, permissions: new Map() };
    const baseline = minPermission(WORKSPACE_ROLE_BASELINE[role], WORKSPACE_ROLE_CEILING[role]);
    return baseline === 'none'
      ? { mode: 'map', role, permissions: new Map() }
      : { mode: 'all', role };
  }

  const nodeRows = await conn.query<NodeRow>(sql`
    SELECT id, parent_id, inherits_permissions, created_by
      FROM pages WHERE workspace_id = ${workspaceId}
  `);

  const permissions = buildIndexFrom({
    userId,
    role,
    nodes: nodeRows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      inheritsPermissions: r.inherits_permissions,
      createdBy: r.created_by,
    })),
    entries: entryRows.map((r) => ({
      pageId: r.page_id,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      role: r.role,
      depth: 0,
    })),
  });

  return { mode: 'map', role, permissions };
}

/* ── 樹狀結果的過濾 ───────────────────────────────────── */

export interface FilterableNode {
  id: string;
  parentId: string | null;
  hasChildren?: boolean;
}

/**
 * 把一份「扁平樹」濾成「這個使用者看得見的子樹」。
 *
 * 設計決定（第七輪）：**祖先沒權限就不顯示佔位節點**，改把看得見的節點
 * 往上掛到「最近的看得見的祖先」（沒有就掛到根）。理由：
 *   - 佔位節點還是會洩漏「這條路徑上有幾層、叫什麼」——標題要遮掉才安全，
 *     遮掉之後在側邊欄就是一串「未命名」，比直接掛根更難用
 *   - 前端組樹只認 `parentId`，掛根不必改任何型別或元件
 *
 * `hasChildren` 一併依**可見的**子節點重算，否則使用者會看到展不開的箭頭。
 */
export function filterTree<T extends FilterableNode>(nodes: T[], index: PermissionIndex): T[] {
  if (index.mode === 'all') return nodes;

  const byId = new Map<string, T>();
  for (const n of nodes) byId.set(n.id, n);

  const visible = nodes.filter((n) => canSee(index, n.id));
  const visibleIds = new Set(visible.map((n) => n.id));

  const nearestVisibleAncestor = (node: T): string | null => {
    let cursor = node.parentId;
    let depth = 0;
    while (cursor !== null && depth < MAX_CHAIN_DEPTH) {
      if (visibleIds.has(cursor)) return cursor;
      const parent = byId.get(cursor);
      if (!parent) return null;
      cursor = parent.parentId;
      depth += 1;
    }
    return null;
  };

  const rewired = visible.map((n) => ({ ...n, parentId: nearestVisibleAncestor(n) }));
  const withChildren = new Set(
    rewired.map((n) => n.parentId).filter((id): id is string => id !== null),
  );
  return rewired.map((n) =>
    n.hasChildren === undefined ? n : { ...n, hasChildren: withChildren.has(n.id) },
  );
}
