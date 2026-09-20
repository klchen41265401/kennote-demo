/**
 * 留言輸入框的 `@` 提及選單觸發規則（gap-review C-3）。
 *
 * 保守是刻意的：使用者打「下午 3 點 @ 開會」或 email 不該把選單叫出來。
 */
import { describe, expect, it } from 'vitest';
import { mentionQueryAt } from '../CommentInput';

describe('mentionQueryAt', () => {
  it('游標前最後一個 @ 之後的字就是 query', () => {
    expect(mentionQueryAt('請 @小明 看一下', 5)).toEqual({ start: 2, query: '小明' });
  });

  it('剛打完 @ 時 query 是空字串（列出全部成員）', () => {
    expect(mentionQueryAt('請 @', 3)).toEqual({ start: 2, query: '' });
  });

  it('@ 之後有空白就不再是 mention', () => {
    expect(mentionQueryAt('@ 開會', 4)).toBeNull();
  });

  it('沒有 @ 回 null', () => {
    expect(mentionQueryAt('一般留言', 4)).toBeNull();
  });

  it('email 形狀（@ 之後又有 @）不觸發', () => {
    expect(mentionQueryAt('a@b@c', 5)).toEqual({ start: 3, query: 'c' });
    expect(mentionQueryAt('寄到 a@b.com 給我', 10)).toEqual({ start: 4, query: 'b.com' });
  });

  it('游標在 @ 之前時看不到它', () => {
    expect(mentionQueryAt('請 @小明', 1)).toBeNull();
  });

  it('超長的 query 不觸發（使用者只是在打一長串含 @ 的字）', () => {
    expect(mentionQueryAt(`@${'x'.repeat(40)}`, 41)).toBeNull();
  });
});
