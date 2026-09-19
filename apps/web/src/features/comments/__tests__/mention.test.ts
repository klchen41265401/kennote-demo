/**
 * 第六輪 BUG-30：留言框的 `@某人` 要變成 mention atom，
 * 否則後端 `extractMentionedUserIds()` 掃不到，整條「提及 → 通知」鏈路走不到。
 */
import { describe, expect, it } from 'vitest';
import { plainToBody, type MentionCandidate } from '../api';

const members: MentionCandidate[] = [
  { userId: 'u-ming', user: { name: '小明', email: 'ming@example.com' } },
  { userId: 'u-minghua', user: { name: '小明華', email: 'minghua@example.com' } },
  { userId: 'u-amy', user: { name: 'Amy', email: 'amy.chen@example.com' } },
];

const atoms = (body: ReturnType<typeof plainToBody>): string[] =>
  body
    .filter((n) => (n as { atom?: string }).atom === 'mention')
    .map((n) => String((n as { data?: { userId?: string } }).data?.userId));

describe('plainToBody（留言框的提及解析）', () => {
  it('沒有成員清單時退回純文字（與修正前的行為一致）', () => {
    expect(plainToBody('哈囉 @小明')).toEqual([{ text: '哈囉 @小明' }]);
  });

  it('`@名字` 變成 mention atom，前後的文字保留', () => {
    const body = plainToBody('請 @小明 看一下', members);
    expect(atoms(body)).toEqual(['u-ming']);
    expect(body[0]).toEqual({ text: '請 ' });
    expect(body[2]).toEqual({ text: ' 看一下' });
  });

  it('最長匹配優先：`@小明華` 不會被 `小明` 先吃掉', () => {
    expect(atoms(plainToBody('@小明華 你好', members))).toEqual(['u-minghua']);
  });

  it('也認 email 的本地部分，大小寫不計', () => {
    expect(atoms(plainToBody('@AMY.CHEN 早', members))).toEqual(['u-amy']);
  });

  it('比不到的 `@` 原樣留成文字，不會把使用者打的字吃掉', () => {
    const body = plainToBody('@下午三點開會', members);
    expect(atoms(body)).toEqual([]);
    expect(body).toEqual([{ text: '@下午三點開會' }]);
  });

  it('一則留言可以提及多個人', () => {
    expect(atoms(plainToBody('@小明 跟 @Amy 都看一下', members))).toEqual(['u-ming', 'u-amy']);
  });

  it('空白 / 純空字串仍然回空陣列（送出前的擋門）', () => {
    expect(plainToBody('   ', members)).toEqual([]);
    expect(plainToBody('', members)).toEqual([]);
  });

  it('atom 帶得出後端要的 `data.userId`', () => {
    const body = plainToBody('@小明', members);
    expect(body[0]).toEqual({ atom: 'mention', data: { userId: 'u-ming', text: '@小明' } });
  });
});
