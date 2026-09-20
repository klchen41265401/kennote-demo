/**
 * 「更新」feed 的聚合（gap-review B-5）。純邏輯，不需要資料庫。
 *
 * 守住三件事：
 *  1. 一筆 tx 裡 block.* 與 page.update **分成兩則**（Notion 的 feed 把
 *     「改標題」跟「編輯內文」分開講）
 *  2. 同一個人 5 分鐘內的相鄰編輯**合併**，且 summary 的數字是去重後的 block 數
 *  3. 三種來源（編輯 / 留言 / 解決）混在一起後依時間新→舊排序
 */
import { describe, expect, it } from 'vitest';
import type { Operation } from '@kennote/shared-types';
import { buildUpdates, groupUpdates } from '../src/modules/history/updates.js';

const at = (min: number): string => new Date(Date.UTC(2026, 8, 20, 10, min, 0)).toISOString();

const insert = (id: string): Operation => ({
  type: 'block.insert',
  blockId: id,
  parentId: null,
  afterId: null,
  blockType: 'paragraph',
  props: {},
  content: [{ text: id }],
});

describe('buildUpdates', () => {
  it('把 block.* 與 page.update 拆成兩則 entry', () => {
    const entries = buildUpdates({
      transactions: [
        {
          seq: 7,
          actor_id: 'u1',
          applied_at: at(10),
          ops: [insert('b1'), { type: 'page.update', patch: { title: [{ text: 'T' }], icon: '📄' } }],
        },
      ],
      comments: [],
      resolved: [],
    });
    expect(entries).toHaveLength(2);
    const edit = entries.find((e) => e.kind === 'edit');
    const prop = entries.find((e) => e.kind === 'property');
    expect(edit?.summary).toBe('編輯了 1 個區塊');
    expect(edit?.seq).toBe(7);
    expect(edit?.blockIds).toEqual(['b1']);
    expect(prop?.properties.sort()).toEqual(['icon', 'title']);
    expect(prop?.summary).toBe('變更了標題、圖示');
  });

  it('text.delta 也算「編輯了這個區塊」', () => {
    const entries = buildUpdates({
      transactions: [
        {
          seq: 3,
          actor_id: 'u1',
          applied_at: at(1),
          ops: [{ type: 'text.delta', blockId: 'b9', delta: [] as never, baseRev: 1 } as Operation],
        },
      ],
      comments: [],
      resolved: [],
    });
    expect(entries.map((e) => e.summary)).toEqual(['編輯了 1 個區塊']);
  });

  it('同一個人 5 分鐘內的相鄰編輯合併，block 去重後重算數字', () => {
    const entries = buildUpdates({
      transactions: [
        { seq: 3, actor_id: 'u1', applied_at: at(12), ops: [insert('b1'), insert('b2')] },
        { seq: 2, actor_id: 'u1', applied_at: at(11), ops: [insert('b2')] },
        { seq: 1, actor_id: 'u1', applied_at: at(10), ops: [insert('b3')] },
      ],
      comments: [],
      resolved: [],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.summary).toBe('編輯了 3 個區塊');
    // 合併後保留**最新**那一筆的 seq（「查看本次更新後的版本」要跳到結果）
    expect(entries[0]!.seq).toBe(3);
    expect(entries[0]!.at).toBe(at(12));
  });

  it('不同的人不合併；超過 5 分鐘也不合併', () => {
    const entries = buildUpdates({
      transactions: [
        { seq: 3, actor_id: 'u2', applied_at: at(12), ops: [insert('b1')] },
        { seq: 2, actor_id: 'u1', applied_at: at(11), ops: [insert('b2')] },
        { seq: 1, actor_id: 'u1', applied_at: at(0), ops: [insert('b3')] },
      ],
      comments: [],
      resolved: [],
    });
    expect(entries).toHaveLength(3);
  });

  it('留言 / 解決與編輯混在同一條時間線，新→舊', () => {
    const entries = buildUpdates({
      transactions: [{ seq: 1, actor_id: 'u1', applied_at: at(10), ops: [insert('b1')] }],
      comments: [
        {
          id: 'c1',
          discussion_id: 'd1',
          author_id: 'u2',
          plain_text: '  這裡\n要改  ',
          created_at: at(20),
        },
      ],
      resolved: [{ id: 'd1', resolved_by: 'u1', resolved_at: at(30) }],
    });
    expect(entries.map((e) => e.kind)).toEqual(['comment_resolved', 'comment', 'edit']);
    expect(entries[1]!.snippet).toBe('這裡 要改');
    expect(entries[1]!.discussionId).toBe('d1');
    expect(entries[0]!.summary).toBe('解決了一個討論串');
  });

  it('留言不會被合併（每一則都要看得到）', () => {
    const out = groupUpdates([
      {
        id: 'comment:c2',
        kind: 'comment',
        seq: null,
        actorId: 'u1',
        at: at(11),
        summary: '留言',
        blockIds: [],
        discussionId: 'd1',
        snippet: 'b',
        properties: [],
      },
      {
        id: 'comment:c1',
        kind: 'comment',
        seq: null,
        actorId: 'u1',
        at: at(10),
        summary: '留言',
        blockIds: [],
        discussionId: 'd1',
        snippet: 'a',
        properties: [],
      },
    ]);
    expect(out).toHaveLength(2);
  });

  it('沒有任何 op 的 tx 不產生 entry', () => {
    const entries = buildUpdates({
      transactions: [{ seq: 1, actor_id: 'u1', applied_at: at(1), ops: [] }],
      comments: [],
      resolved: [],
    });
    expect(entries).toEqual([]);
  });
});
