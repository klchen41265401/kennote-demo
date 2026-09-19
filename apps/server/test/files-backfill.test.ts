/**
 * 第十輪：附件回填腳本的**決策規則**（`scripts/backfill-file-pages.ts` 的 `decide()`）。
 *
 * 為什麼只測這一支純函式、不測整條 SQL：
 * 回填腳本的風險不在「SQL 撈不撈得到」，而在**「撈到之後決定怎麼寫」** ——
 * 一個附件被三頁引用時挑哪一頁、跨工作區的引用要不要信。
 * 這兩條判斷錯了，結果是把私密附件的權限**放寬**，而且沒有任何人會發現。
 *
 * 紅線：`decide()` 的錯誤方向只能是「不做」（留 NULL = 維持成員限定 = 現況），
 * 絕對不能是「挑一個看起來合理的」。
 */
import { describe, expect, it } from 'vitest';
import { decide } from '../scripts/backfill-file-pages.js';

const WS_A = '00000000-0000-0000-0000-00000000000a';
const WS_B = '00000000-0000-0000-0000-00000000000b';
const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '22222222-2222-2222-2222-222222222222';

describe('backfill-file-pages / decide()', () => {
  it('只被一頁引用、同工作區 → 回填那一頁', () => {
    expect(
      decide({ file_workspace_id: WS_A, page_ids: [P1], page_workspace_ids: [WS_A] }),
    ).toEqual({ action: 'update', pageId: P1 });
  });

  it('同一頁被引用很多次（同一頁裡有兩張一樣的圖）仍然算一頁', () => {
    expect(
      decide({ file_workspace_id: WS_A, page_ids: [P1, P1, P1], page_workspace_ids: [WS_A] }),
    ).toEqual({ action: 'update', pageId: P1 });
  });

  it('⭐ 被兩頁引用 → 整個跳過，不挑其中一頁', () => {
    // 複製頁面 / 複製 block 會讓同一個 fileId 出現在好幾頁。
    // 隨便挑一頁 = 隨便挑一組權限，而且可能挑到比較鬆的那一組。
    expect(
      decide({ file_workspace_id: WS_A, page_ids: [P1, P2], page_workspace_ids: [WS_A, WS_A] }),
    ).toEqual({ action: 'multi-page' });
  });

  it('⭐ 引用它的頁面在別的工作區 → 跳過', () => {
    expect(
      decide({ file_workspace_id: WS_A, page_ids: [P1], page_workspace_ids: [WS_B] }),
    ).toEqual({ action: 'cross-workspace' });
  });

  it('沒有任何引用 → 什麼都不做（頭像、匯入暫存、孤兒）', () => {
    expect(decide({ file_workspace_id: WS_A, page_ids: [], page_workspace_ids: [] })).toEqual({
      action: 'none',
    });
  });

  it('回傳的 action 只有這四種 —— 沒有「猜一個」的出口', () => {
    const actions = new Set(
      [
        decide({ file_workspace_id: WS_A, page_ids: [P1], page_workspace_ids: [WS_A] }),
        decide({ file_workspace_id: WS_A, page_ids: [P1, P2], page_workspace_ids: [WS_A, WS_A] }),
        decide({ file_workspace_id: WS_A, page_ids: [P1], page_workspace_ids: [WS_B] }),
        decide({ file_workspace_id: WS_A, page_ids: [], page_workspace_ids: [] }),
      ].map((r) => r.action),
    );
    expect([...actions].sort()).toEqual(['cross-workspace', 'multi-page', 'none', 'update']);
  });
});
