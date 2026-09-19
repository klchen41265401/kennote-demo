/**
 * 頁面樹的純邏輯：組樹、排序、扁平化、循環判定、麵包屑。
 *
 * 刻意完全不碰 DOM / React —— 這一支是 side-bar 拖曳與麵包屑的正確性核心，
 * 必須能單獨用 vitest 測（02 §4.2、01 §3）。
 */
import type { PageTreeNode } from '@kennote/shared-types';

export interface TreeNode extends PageTreeNode {
  depth: number;
  children: TreeNode[];
}

/** 側邊欄一列（扁平化之後的可視列） */
export interface FlatRow {
  node: TreeNode;
  depth: number;
  /** 真的有子頁面（樹上看得到的，不是後端的 hasChildren 旗標） */
  hasChildren: boolean;
}

/** 後端的 sortKey 是字典序的 fractional index；同 key 時以 id 決勝保證穩定 */
export function compareNodes(a: PageTreeNode, b: PageTreeNode): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 扁平陣列 → 樹。
 * - parentId 指向不存在（或已刪除）的節點時當成根節點，避免整個分支消失。
 * - 資料若有環（理論上後端會擋），沿著環的節點會被丟到根層而不是無限遞迴。
 */
export function buildTree(nodes: readonly PageTreeNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) byId.set(n.id, { ...n, depth: 0, children: [] });

  const roots: TreeNode[] = [];
  for (const n of nodes) {
    const node = byId.get(n.id)!;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!parent || parent === node || hasCycle(node.id, byId)) roots.push(node);
    else parent.children.push(node);
  }

  const sortRec = (list: TreeNode[], depth: number): TreeNode[] => {
    list.sort(compareNodes);
    for (const n of list) {
      n.depth = depth;
      sortRec(n.children, depth + 1);
    }
    return list;
  };

  return sortRec(roots, 0);
}

function hasCycle(startId: string, byId: Map<string, TreeNode>): boolean {
  const seen = new Set<string>([startId]);
  let cur = byId.get(startId);
  while (cur?.parentId) {
    if (seen.has(cur.parentId)) return true;
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId);
    if (!cur) return false;
  }
  return false;
}

/** 依展開狀態把樹壓成可視列（給虛擬捲動 / 拖曳落點用） */
export function flattenVisible(
  roots: readonly TreeNode[],
  expanded: ReadonlySet<string>,
): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (list: readonly TreeNode[], depth: number): void => {
    for (const node of list) {
      const hasChildren = node.children.length > 0 || node.hasChildren;
      out.push({ node, depth, hasChildren });
      if (node.children.length > 0 && expanded.has(node.id)) walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

/** targetId 是否為 sourceId 的子孫（含自己）—— 拖曳時的循環禁止判定 */
export function isDescendant(
  nodes: readonly PageTreeNode[],
  sourceId: string,
  targetId: string,
): boolean {
  if (sourceId === targetId) return true;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let cur = byId.get(targetId);
  const seen = new Set<string>();
  while (cur?.parentId) {
    if (seen.has(cur.parentId)) return false; // 資料有環，當成不是子孫
    if (cur.parentId === sourceId) return true;
    seen.add(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return false;
}

/** 把一個頁面搬到 parentId 底下是否合法（不能搬進自己或自己的子孫） */
export function canMove(
  nodes: readonly PageTreeNode[],
  sourceId: string,
  parentId: string | null,
): boolean {
  if (parentId === null) return true;
  return !isDescendant(nodes, sourceId, parentId);
}

/** 收集所有子孫 id（拖曳時要 disable 掉，避免拖進自己裡面） */
export function descendantIds(nodes: readonly PageTreeNode[], sourceId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const arr = childrenOf.get(n.parentId);
    if (arr) arr.push(n.id);
    else childrenOf.set(n.parentId, [n.id]);
  }
  const out: string[] = [];
  const stack = [sourceId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    for (const c of childrenOf.get(id) ?? []) stack.push(c);
  }
  return out;
}

/** 祖先鏈（由根到自己，含自己）—— 麵包屑與「展開到這一頁」共用 */
export function ancestorChain(nodes: readonly PageTreeNode[], pageId: string): PageTreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: PageTreeNode[] = [];
  const seen = new Set<string>();
  let cur = byId.get(pageId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

/**
 * 麵包屑省略：超過 max 段時保留「第一段 + … + 最後 (max-2) 段」。
 * 回傳 `null` 代表省略記號的位置，中間被折起來的項目由呼叫端從原陣列取。
 */
export interface EllipsisResult<T> {
  head: T[];
  hidden: T[];
  tail: T[];
}

export function collapseBreadcrumb<T>(items: readonly T[], max = 4): EllipsisResult<T> {
  if (items.length <= max) return { head: [...items], hidden: [], tail: [] };
  const tailCount = Math.max(1, max - 2);
  return {
    head: items.slice(0, 1),
    hidden: items.slice(1, items.length - tailCount),
    tail: items.slice(items.length - tailCount),
  };
}

/** 側邊欄「… 更多」：超過 N 筆先收起來 */
export function limitWithMore<T>(items: readonly T[], limit: number, showAll: boolean): T[] {
  if (showAll || items.length <= limit) return [...items];
  return items.slice(0, limit);
}

/** 頁面標題的統一 fallback（Notion 顯示「無標題」） */
export function displayTitle(title: string | null | undefined): string {
  const t = (title ?? '').trim();
  return t.length > 0 ? t : '無標題';
}
