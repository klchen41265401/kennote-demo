/**
 * applyTransaction 的 op 語意 —— 逐條對照
 * `apps/server/src/modules/blocks/apply-transaction.ts`。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Operation, Transaction } from '@kennote/shared-types';
import {
  applyTransaction,
  buildSnapshot,
  createPage,
  rebuildSnapshotAt,
  transactionsSince,
} from '../core';
import { emptyState, replaceState, store } from '../store';
import { uuid } from '../util';

function freshWorkspace(): string {
  replaceState(emptyState());
  store.state.users['u1'] = {
    id: 'u1',
    name: 'Demo',
    email: 'demo@kennote.local',
    avatarUrl: null,
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    emailVerified: true,
    createdAt: new Date().toISOString(),
    preferences: {},
  };
  store.state.sessionUserId = 'u1';
  const id = 'ws1';
  store.state.workspaces[id] = {
    id,
    name: 'Demo',
    slug: 'demo',
    icon: null,
    role: 'owner',
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
  return id;
}

function tx(pageId: string, ops: Operation[], txId = uuid()): Transaction {
  return { txId, pageId, originSessionId: 'test', ops };
}

describe('demo applyTransaction', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = freshWorkspace();
  });

  it('block.insert 會照 afterId 插進 children，seq 遞增', () => {
    const page = createPage({ workspaceId, title: [], seedParagraph: false });
    const a = uuid();
    const b = uuid();
    const c = uuid();
    const result = applyTransaction(
      page.id,
      tx(page.id, [
        { type: 'block.insert', blockId: a, parentId: null, afterId: null, blockType: 'paragraph', props: {}, content: [{ text: 'A' }] },
        { type: 'block.insert', blockId: b, parentId: null, afterId: a, blockType: 'paragraph', props: {}, content: [{ text: 'B' }] },
        { type: 'block.insert', blockId: c, parentId: null, afterId: null, blockType: 'paragraph', props: {}, content: [{ text: 'C' }] },
      ]),
    );
    expect(result.seq).toBe(1);
    // afterId = null → 插到最前面
    expect(buildSnapshot(page.id).rootBlockIds).toEqual([c, a, b]);
  });

  it('同一個 txId 重送是冪等的（回上一次的結果，不會重複套用）', () => {
    const page = createPage({ workspaceId, title: [], seedParagraph: false });
    const blockId = uuid();
    const transaction = tx(page.id, [
      { type: 'block.insert', blockId, parentId: null, afterId: null, blockType: 'paragraph', props: {}, content: [] },
    ]);
    const first = applyTransaction(page.id, transaction);
    const second = applyTransaction(page.id, transaction);
    expect(second.seq).toBe(first.seq);
    expect(buildSnapshot(page.id).rootBlockIds).toHaveLength(1);
  });

  it('block.insert 重複同一個 blockId 視為 no-op（離線佇列重送）', () => {
    const page = createPage({ workspaceId, title: [], seedParagraph: false });
    const blockId = uuid();
    const op: Operation = {
      type: 'block.insert', blockId, parentId: null, afterId: null, blockType: 'paragraph', props: {}, content: [],
    };
    applyTransaction(page.id, tx(page.id, [op]));
    applyTransaction(page.id, tx(page.id, [op]));
    expect(buildSnapshot(page.id).rootBlockIds).toEqual([blockId]);
  });

  it('block.update 會 bump version，baseVersion 不符時標記 conflicts 但仍套用（LWW）', () => {
    const page = createPage({ workspaceId, title: [], seedParagraph: false });
    const blockId = uuid();
    applyTransaction(page.id, tx(page.id, [
      { type: 'block.insert', blockId, parentId: null, afterId: null, blockType: 'paragraph', props: {}, content: [] },
    ]));
    const result = applyTransaction(page.id, tx(page.id, [
      { type: 'block.update', blockId, patch: { content: [{ text: '你好' }] }, baseVersion: 99 },
    ]));
    expect(result.conflicts).toEqual([blockId]);
    const block = buildSnapshot(page.id).recordMap.block[blockId]!.value;
    expect(block.content).toEqual([{ text: '你好' }]);
    expect(block.version).toBe(2);
  });

  it('block.move 會從舊 parent 移除、掛到新 parent，且不能搬進自己的子孫', () => {
    const page = createPage({ workspaceId, title: [], seedParagraph: false });
    const toggle = uuid();
    const child = uuid();
    applyTransaction(page.id, tx(page.id, [
      { type: 'block.insert', blockId: toggle, parentId: null, afterId: null, blockType: 'toggle', props: {}, content: [] },
      { type: 'block.insert', blockId: child, parentId: null, afterId: toggle, blockType: 'paragraph', props: {}, content: [] },
    ]));
    applyTransaction(page.id, tx(page.id, [
      { type: 'block.move', blockId: child, parentId: toggle, afterId: null },
    ]));
    const snap = buildSnapshot(page.id);
    expect(snap.rootBlockIds).toEqual([toggle]);
    expect(snap.recordMap.block[toggle]!.value.children).toEqual([child]);

    expect(() =>
      applyTransaction(page.id, tx(page.id, [
        { type: 'block.move', blockId: toggle, parentId: child, afterId: null },
      ])),
    ).toThrow(/子區塊/);
  });

  it('block.delete 會連子孫一起軟刪除，重複刪是 no-op', () => {
    const page = createPage({ workspaceId, title: [], seedParagraph: false });
    const parent = uuid();
    const child = uuid();
    applyTransaction(page.id, tx(page.id, [
      { type: 'block.insert', blockId: parent, parentId: null, afterId: null, blockType: 'toggle', props: {}, content: [] },
      { type: 'block.insert', blockId: child, parentId: parent, afterId: null, blockType: 'paragraph', props: {}, content: [] },
    ]));
    applyTransaction(page.id, tx(page.id, [{ type: 'block.delete', blockId: parent }]));
    const snap = buildSnapshot(page.id);
    expect(snap.rootBlockIds).toEqual([]);
    expect(snap.recordMap.block[child]).toBeUndefined();
    // 再刪一次不會爆
    expect(() =>
      applyTransaction(page.id, tx(page.id, [{ type: 'block.delete', blockId: parent }])),
    ).not.toThrow();
  });

  it('page.update 會改標題 / icon / cover', () => {
    const page = createPage({ workspaceId, title: [], seedParagraph: false });
    applyTransaction(page.id, tx(page.id, [
      { type: 'page.update', patch: { title: [{ text: '新標題' }], icon: '🔥' } },
    ]));
    const value = buildSnapshot(page.id).recordMap.page[page.id]!.value;
    expect(value.title).toEqual([{ text: '新標題' }]);
    expect(value.icon).toBe('🔥');
  });

  it('text.delta 在 demo 一律 501（/api/health 已回報 features.ot = false）', () => {
    const page = createPage({ workspaceId, title: [], seedParagraph: false });
    expect(() =>
      applyTransaction(page.id, tx(page.id, [
        { type: 'text.delta', blockId: uuid(), delta: { ops: [] }, baseRev: 0 },
      ])),
    ).toThrow(/OT/);
  });

  it('transactionsSince 只回 seq 大於參數的，且依序排列', () => {
    const page = createPage({ workspaceId, title: [], seedParagraph: false });
    for (let i = 0; i < 3; i += 1) {
      applyTransaction(page.id, tx(page.id, [
        { type: 'block.insert', blockId: uuid(), parentId: null, afterId: null, blockType: 'paragraph', props: {}, content: [] },
      ]));
    }
    const since = transactionsSince(page.id, 1);
    expect(since.map((r) => r.seq)).toEqual([2, 3]);
  });

  it('rebuildSnapshotAt 從 operation log 重播出歷史版本', () => {
    const page = createPage({ workspaceId, title: [], seedParagraph: false });
    const a = uuid();
    applyTransaction(page.id, tx(page.id, [
      { type: 'block.insert', blockId: a, parentId: null, afterId: null, blockType: 'paragraph', props: {}, content: [{ text: '第一版' }] },
    ]));
    applyTransaction(page.id, tx(page.id, [
      { type: 'block.update', blockId: a, patch: { content: [{ text: '第二版' }] } },
    ]));
    const v1 = rebuildSnapshotAt(page.id, 1);
    expect(v1.recordMap.block[a]!.value.content).toEqual([{ text: '第一版' }]);
    const v2 = rebuildSnapshotAt(page.id, 2);
    expect(v2.recordMap.block[a]!.value.content).toEqual([{ text: '第二版' }]);
    // 現況與最新版本一致
    expect(buildSnapshot(page.id).recordMap.block[a]!.value.content).toEqual([{ text: '第二版' }]);
  });

  it('建立頁面時會自動種一個空 paragraph（與伺服器一致）', () => {
    const page = createPage({ workspaceId, title: [] });
    const snap = buildSnapshot(page.id);
    expect(snap.rootBlockIds).toHaveLength(1);
    expect(snap.recordMap.block[snap.rootBlockIds[0]!]!.value.type).toBe('paragraph');
  });
});
