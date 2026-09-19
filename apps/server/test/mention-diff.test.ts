/**
 * 第七輪：block 內 `@提及` 的差集（第六輪 §5-3）。
 * 這是「編輯時不會重複通知」的唯一保證，所以單獨釘住。
 */
import type { InlineNode } from '@kennote/shared-types';
import { describe, expect, it } from 'vitest';
import { diffMentions } from '../src/modules/blocks/apply-transaction.js';

const mention = (userId: string): InlineNode =>
  ({ atom: 'mention', data: { userId } }) as InlineNode;

describe('diffMentions', () => {
  it('新增的提及才回報', () => {
    const diff = diffMentions('b1', [{ text: '嗨' }], [{ text: '嗨 ' }, mention('u1')]);
    expect(diff?.added).toEqual(['u1']);
    expect(diff?.blockId).toBe('b1');
  });

  it('本來就在的提及不再回報（每打一個字都會進來一次）', () => {
    const before = [{ text: '請 ' }, mention('u1'), { text: ' 看' }];
    const after = [{ text: '請 ' }, mention('u1'), { text: ' 看一下' }];
    expect(diffMentions('b1', before, after)).toBeNull();
  });

  it('只回報新的那一個（舊的留著、又加了一個）', () => {
    const before = [mention('u1')];
    const after = [mention('u1'), mention('u2')];
    expect(diffMentions('b1', before, after)?.added).toEqual(['u2']);
  });

  it('刪掉提及不會產生通知', () => {
    expect(diffMentions('b1', [mention('u1')], [{ text: '沒了' }])).toBeNull();
  });

  it('snippet 是變更後的純文字（截斷在 160 字）', () => {
    const diff = diffMentions('b1', [], [{ text: '請 ' }, mention('u1'), { text: ' 看一下報表' }]);
    expect(diff?.snippet).toContain('看一下報表');
    expect((diff?.snippet ?? '').length).toBeLessThanOrEqual(160);
  });

  it('新建的 block 帶提及 → before 是空的，照樣通知', () => {
    expect(diffMentions('b2', [], [mention('u9')])?.added).toEqual(['u9']);
  });
});
