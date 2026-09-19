/**
 * 第七輪：批次頁面權限（側邊欄頁面樹 / 垃圾桶 / 最近 / 收藏的 per-page 過濾）。
 * 純邏輯，不需要資料庫 —— `buildIndexFrom()` 與 `filterTree()` 收的都是已經查好的列。
 *
 * 釘住兩件事：
 *   1. 批次結果與單頁 `resolvePermission()` **逐頁相同**（不可能算出兩套答案）
 *   2. 1000 頁的折疊 < 200ms（第六輪 §5-1 的效能要求）
 */
import { describe, expect, it } from 'vitest';
import {
  buildIndexFrom,
  canSee,
  filterTree,
  permissionOf,
  type PageNodeMeta,
  type PermissionIndex,
} from '../src/modules/permissions/bulk.js';
import {
  resolvePermission,
  type PermissionEntryInput,
} from '../src/modules/permissions/resolve.js';

type Entry = PermissionEntryInput & { pageId: string };

const userEntry = (pageId: string, subjectId: string, role: Entry['role']): Entry => ({
  pageId,
  subjectType: 'user',
  subjectId,
  role,
  depth: 0,
});

const node = (
  id: string,
  parentId: string | null = null,
  extra: Partial<PageNodeMeta> = {},
): PageNodeMeta => ({
  id,
  parentId,
  inheritsPermissions: true,
  createdBy: 'owner-user',
  ...extra,
});

const mapIndex = (permissions: Map<string, ReturnType<typeof permissionOf>>): PermissionIndex => ({
  mode: 'map',
  role: 'guest',
  permissions,
});

describe('buildIndexFrom（一次折疊整個工作區）', () => {
  it('guest 的 baseline 是 none：沒有條目的頁面一律看不到', () => {
    const perms = buildIndexFrom({
      userId: 'guest-user',
      role: 'guest',
      nodes: [node('a'), node('b')],
      entries: [userEntry('a', 'guest-user', 'commenter')],
    });
    expect(perms.get('a')).toBe('comment');
    expect(perms.get('b')).toBe('none');
  });

  it('授權會沿繼承鏈往下傳（父頁授權 → 子孫看得到）', () => {
    const perms = buildIndexFrom({
      userId: 'guest-user',
      role: 'guest',
      nodes: [node('root'), node('child', 'root'), node('grandchild', 'child')],
      entries: [userEntry('root', 'guest-user', 'reader')],
    });
    expect(perms.get('child')).toBe('read');
    expect(perms.get('grandchild')).toBe('read');
  });

  it('inherits_permissions = false 會切斷繼承（中斷點以上的條目不算）', () => {
    const perms = buildIndexFrom({
      userId: 'guest-user',
      role: 'guest',
      nodes: [
        node('root'),
        node('child', 'root', { inheritsPermissions: false }),
        node('grandchild', 'child'),
      ],
      entries: [userEntry('root', 'guest-user', 'reader')],
    });
    expect(perms.get('root')).toBe('read');
    // child 自己是中斷點：它自己的條目還算數，但不再往上收 root 的
    expect(perms.get('child')).toBe('none');
    expect(perms.get('grandchild')).toBe('none');
  });

  it('member：別人的條目不影響我的 baseline，指名我的條目才算', () => {
    const perms = buildIndexFrom({
      userId: 'member-user',
      role: 'member',
      nodes: [node('a'), node('b'), node('c')],
      entries: [
        // 「只給別人」的條目對我不適用 → 我在 b 上仍然是 baseline（與單頁版同一條規則）
        userEntry('b', 'someone-else', 'editor'),
        // 指名我、角色 none → 明確收回
        userEntry('c', 'member-user', 'none'),
      ],
    });
    expect(perms.get('a')).toBe('edit');
    expect(perms.get('b')).toBe('edit');
    expect(perms.get('c')).toBe('none');
  });

  it('建立者視同 full（自己建的頁面不會被別人的條目綁住）', () => {
    const perms = buildIndexFrom({
      userId: 'me',
      role: 'guest',
      nodes: [node('mine', null, { createdBy: 'me' })],
      entries: [userEntry('mine', 'someone-else', 'editor')],
    });
    expect(perms.get('mine')).toBe('full');
  });

  it('非成員（role = null）只認直接指名他的條目，且封頂在 edit', () => {
    const perms = buildIndexFrom({
      userId: 'outsider',
      role: null,
      nodes: [node('shared'), node('other')],
      entries: [userEntry('shared', 'outsider', 'owner')],
    });
    expect(perms.get('shared')).toBe('edit');
    expect(perms.get('other')).toBe('none');
  });

  it('逐頁與單頁的 resolvePermission() 完全一致', () => {
    const nodes = [node('root'), node('a', 'root'), node('b', 'root'), node('c', 'a')];
    const entries: Entry[] = [
      userEntry('root', 'me', 'reader'),
      userEntry('a', 'me', 'editor'),
      userEntry('b', 'other', 'editor'),
    ];
    const perms = buildIndexFrom({ userId: 'me', role: 'member', nodes, entries });

    for (const n of nodes) {
      // 單頁版：自己沿鏈把條目收齊（等同 repo.collectInheritedEntries 的 CTE）
      const chain: Entry[] = [];
      let cursor: string | null = n.id;
      while (cursor) {
        const current: PageNodeMeta | undefined = nodes.find((x) => x.id === cursor);
        if (!current) break;
        chain.push(...entries.filter((e) => e.pageId === current.id));
        cursor = current.inheritsPermissions ? current.parentId : null;
      }
      const single = resolvePermission({
        userId: 'me',
        workspaceRole: 'member',
        entries: chain,
        isPageOwner: n.createdBy === 'me',
      });
      expect(perms.get(n.id), `頁面 ${n.id}`).toBe(single);
    }
  });
});

describe('filterTree（側邊欄的可見子樹）', () => {
  it('看不見的節點整個消失，看得見的往上掛到最近的可見祖先', () => {
    const perms = new Map([
      ['root', 'none' as const],
      ['mid', 'none' as const],
      ['leaf', 'read' as const],
    ]);
    const tree = [
      { id: 'root', parentId: null, hasChildren: true, title: 'root' },
      { id: 'mid', parentId: 'root', hasChildren: true, title: 'mid' },
      { id: 'leaf', parentId: 'mid', hasChildren: false, title: 'leaf' },
    ];
    const out = filterTree(tree, mapIndex(perms));
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('leaf');
    // 祖先的標題一個字都不會出現在回應裡
    expect(JSON.stringify(out)).not.toContain('mid');
  });

  it('hasChildren 依「可見的」子節點重算（不會留下展不開的箭頭）', () => {
    const perms = new Map([
      ['root', 'read' as const],
      ['hidden', 'none' as const],
    ]);
    const out = filterTree(
      [
        { id: 'root', parentId: null, hasChildren: true },
        { id: 'hidden', parentId: 'root', hasChildren: false },
      ],
      mapIndex(perms),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.hasChildren).toBe(false);
  });

  it('mode = all（owner/admin、或工作區完全沒有條目）原樣回傳', () => {
    const tree = [{ id: 'a', parentId: null, hasChildren: false }];
    expect(filterTree(tree, { mode: 'all', role: 'owner' })).toBe(tree);
  });

  it('canSee / permissionOf 對不在 map 裡的頁面一律 none', () => {
    const index = mapIndex(new Map());
    expect(permissionOf(index, 'unknown')).toBe('none');
    expect(canSee(index, 'unknown')).toBe(false);
  });
});

describe('效能：1000 頁面的折疊 + 過濾', () => {
  it('< 200ms（一次查詢 + 記憶體折疊，不是一頁一次查詢）', () => {
    const N = 1000;
    const nodes: PageNodeMeta[] = [];
    const entries: Entry[] = [];
    // 10 棵樹 × 每棵 100 頁、深度約 10 —— 貼近真實的側邊欄形狀
    for (let t = 0; t < 10; t += 1) {
      const rootId = `r${t}`;
      nodes.push(node(rootId));
      let parent = rootId;
      for (let i = 0; i < N / 10 - 1; i += 1) {
        const id = `p${t}-${i}`;
        nodes.push(node(id, parent));
        if (i % 10 === 9) parent = id; // 每 10 個往下深一層
        if (i % 25 === 0) entries.push(userEntry(id, i % 50 === 0 ? 'me' : 'other', 'editor'));
      }
    }
    expect(nodes).toHaveLength(N);

    const started = performance.now();
    const perms = buildIndexFrom({ userId: 'me', role: 'guest', nodes, entries });
    const tree = nodes.map((n) => ({ id: n.id, parentId: n.parentId, hasChildren: true }));
    const visible = filterTree(tree, { mode: 'map', role: 'guest', permissions: perms });
    const elapsed = performance.now() - started;

    expect(perms.size).toBe(N);
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.length).toBeLessThan(N);
    expect(elapsed).toBeLessThan(200);
  });
});
