import { describe, expect, it } from 'vitest';
import type { PageTreeNode } from '@kennote/shared-types';
import {
  ancestorChain,
  buildTree,
  canMove,
  collapseBreadcrumb,
  compareNodes,
  descendantIds,
  displayTitle,
  flattenVisible,
  isDescendant,
  limitWithMore,
} from './tree';

function node(id: string, parentId: string | null, sortKey = 'a', title = id): PageTreeNode {
  return {
    id,
    workspaceId: 'w',
    parentId,
    title,
    icon: null,
    sortKey,
    isDatabase: false,
    hasChildren: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('compareNodes', () => {
  it('以 sortKey 字典序排序', () => {
    expect(compareNodes(node('a', null, 'a0'), node('b', null, 'a1'))).toBeLessThan(0);
    expect(compareNodes(node('a', null, 'b0'), node('b', null, 'a1'))).toBeGreaterThan(0);
  });

  it('sortKey 相同時用 id 決勝，保證排序穩定', () => {
    expect(compareNodes(node('a', null, 'x'), node('b', null, 'x'))).toBeLessThan(0);
    expect(compareNodes(node('b', null, 'x'), node('b', null, 'x'))).toBe(0);
  });
});

describe('buildTree', () => {
  it('把扁平陣列組成樹並標上 depth', () => {
    const roots = buildTree([
      node('c', 'a', 'a1'),
      node('a', null, 'a0'),
      node('b', 'a', 'a0'),
      node('d', 'b', 'a0'),
    ]);
    expect(roots.map((n) => n.id)).toEqual(['a']);
    expect(roots[0]!.children.map((n) => n.id)).toEqual(['b', 'c']);
    expect(roots[0]!.depth).toBe(0);
    expect(roots[0]!.children[0]!.depth).toBe(1);
    expect(roots[0]!.children[0]!.children[0]!.id).toBe('d');
    expect(roots[0]!.children[0]!.children[0]!.depth).toBe(2);
  });

  it('parentId 指向不存在的節點時當成根節點（分支不會消失）', () => {
    const roots = buildTree([node('x', 'ghost')]);
    expect(roots.map((n) => n.id)).toEqual(['x']);
  });

  it('資料有環時不會無限遞迴', () => {
    const roots = buildTree([node('a', 'b'), node('b', 'a')]);
    expect(roots).toHaveLength(2);
  });

  it('多個根節點依 sortKey 排序', () => {
    const roots = buildTree([node('b', null, 'a2'), node('a', null, 'a1'), node('c', null, 'a3')]);
    expect(roots.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('flattenVisible', () => {
  const nodes = [node('a', null, 'a0'), node('b', 'a', 'a0'), node('c', 'b', 'a0')];

  it('沒展開時只看得到根層', () => {
    const rows = flattenVisible(buildTree(nodes), new Set());
    expect(rows.map((r) => r.node.id)).toEqual(['a']);
    expect(rows[0]!.hasChildren).toBe(true);
  });

  it('展開一層只多出直接子節點', () => {
    const rows = flattenVisible(buildTree(nodes), new Set(['a']));
    expect(rows.map((r) => r.node.id)).toEqual(['a', 'b']);
    expect(rows[1]!.depth).toBe(1);
  });

  it('展開整條鏈', () => {
    const rows = flattenVisible(buildTree(nodes), new Set(['a', 'b']));
    expect(rows.map((r) => r.node.id)).toEqual(['a', 'b', 'c']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2]);
  });
});

describe('循環判定', () => {
  const nodes = [node('a', null), node('b', 'a'), node('c', 'b'), node('d', null)];

  it('isDescendant：自己算子孫', () => {
    expect(isDescendant(nodes, 'a', 'a')).toBe(true);
  });

  it('isDescendant：孫節點也算', () => {
    expect(isDescendant(nodes, 'a', 'c')).toBe(true);
    expect(isDescendant(nodes, 'b', 'c')).toBe(true);
  });

  it('isDescendant：無關的節點不算', () => {
    expect(isDescendant(nodes, 'b', 'd')).toBe(false);
    expect(isDescendant(nodes, 'c', 'a')).toBe(false);
  });

  it('canMove：不能搬進自己的子孫，但可以搬到最上層', () => {
    expect(canMove(nodes, 'a', 'c')).toBe(false);
    expect(canMove(nodes, 'a', 'a')).toBe(false);
    expect(canMove(nodes, 'a', 'd')).toBe(true);
    expect(canMove(nodes, 'a', null)).toBe(true);
  });

  it('descendantIds 含自己，且涵蓋整個子樹', () => {
    expect(descendantIds(nodes, 'a').sort()).toEqual(['a', 'b', 'c']);
    expect(descendantIds(nodes, 'd')).toEqual(['d']);
  });
});

describe('ancestorChain', () => {
  const nodes = [node('a', null), node('b', 'a'), node('c', 'b')];

  it('由根到自己', () => {
    expect(ancestorChain(nodes, 'c').map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('根節點只有自己', () => {
    expect(ancestorChain(nodes, 'a').map((n) => n.id)).toEqual(['a']);
  });

  it('找不到就回空陣列', () => {
    expect(ancestorChain(nodes, 'zzz')).toEqual([]);
  });
});

describe('collapseBreadcrumb', () => {
  const items = [1, 2, 3, 4, 5, 6];

  it('沒超過上限時整串都在 head', () => {
    const r = collapseBreadcrumb([1, 2, 3], 4);
    expect(r).toEqual({ head: [1, 2, 3], hidden: [], tail: [] });
  });

  it('剛好等於上限也不省略', () => {
    expect(collapseBreadcrumb([1, 2, 3, 4], 4).hidden).toEqual([]);
  });

  it('超過上限時保留第一段 + 最後 (max-2) 段', () => {
    const r = collapseBreadcrumb(items, 4);
    expect(r.head).toEqual([1]);
    expect(r.tail).toEqual([5, 6]);
    expect(r.hidden).toEqual([2, 3, 4]);
    expect(r.head.length + r.hidden.length + r.tail.length).toBe(items.length);
  });

  it('max=3 時尾巴只留一段', () => {
    const r = collapseBreadcrumb(items, 3);
    expect(r.head).toEqual([1]);
    expect(r.tail).toEqual([6]);
  });
});

describe('limitWithMore', () => {
  it('showAll 時全部回傳', () => {
    expect(limitWithMore([1, 2, 3], 2, true)).toEqual([1, 2, 3]);
  });
  it('沒超過上限時全部回傳', () => {
    expect(limitWithMore([1, 2], 3, false)).toEqual([1, 2]);
  });
  it('超過上限時截斷', () => {
    expect(limitWithMore([1, 2, 3], 2, false)).toEqual([1, 2]);
  });
});

describe('displayTitle', () => {
  it('空字串 / 空白 / null 都回「無標題」', () => {
    expect(displayTitle('')).toBe('無標題');
    expect(displayTitle('   ')).toBe('無標題');
    expect(displayTitle(null)).toBe('無標題');
    expect(displayTitle(undefined)).toBe('無標題');
  });
  it('有標題就原樣回傳', () => {
    expect(displayTitle('專案計畫')).toBe('專案計畫');
  });
});
