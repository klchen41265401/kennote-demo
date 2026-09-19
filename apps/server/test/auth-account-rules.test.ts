/**
 * 帳號設定的純規則（modules/auth/account-rules.ts）。
 * 不需要資料庫 —— 這些分支（訪客 vs 正式帳號、只有自己 vs 還有別人）
 * 才是真正會出事的地方，必須無條件跑。
 */
import { describe, expect, it } from 'vitest';
import {
  deletedEmailFor,
  isGuestEmail,
  mergePreferences,
  pickOwnershipSuccessor,
  planPasswordChange,
  summarizeSessions,
  type SessionFamilyRow,
} from '../src/modules/auth/account-rules.js';

describe('isGuestEmail', () => {
  it('認得 FEATURE_OPEN_LOGIN 發出來的訪客帳號', () => {
    expect(isGuestEmail('guest-abc123@guest.kennote.local')).toBe(true);
    expect(isGuestEmail('GUEST-ABC@GUEST.KENNOTE.LOCAL')).toBe(true);
  });

  it('正式帳號與空值都不算訪客', () => {
    expect(isGuestEmail('ken@example.com')).toBe(false);
    expect(isGuestEmail('guest.kennote.local@example.com')).toBe(false);
    expect(isGuestEmail(null)).toBe(false);
    expect(isGuestEmail(undefined)).toBe(false);
  });
});

describe('planPasswordChange', () => {
  it('正式帳號沒給舊密碼 → 擋下', () => {
    const plan = planPasswordChange({ isGuest: false, newPassword: 'new-password' });
    expect(plan).toEqual({ ok: false, reason: 'CURRENT_REQUIRED' });
  });

  it('正式帳號給了舊密碼 → 要驗舊密碼', () => {
    const plan = planPasswordChange({
      isGuest: false,
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });
    expect(plan).toEqual({ ok: true, verifyCurrent: true });
  });

  it('訪客帳號可以不給舊密碼直接設定', () => {
    const plan = planPasswordChange({ isGuest: true, newPassword: 'new-password' });
    expect(plan).toEqual({ ok: true, verifyCurrent: false });
  });

  it('新密碼太短 / 太長都擋下，且比「沒給舊密碼」更早判斷', () => {
    expect(planPasswordChange({ isGuest: false, newPassword: 'short' })).toEqual({
      ok: false,
      reason: 'TOO_SHORT',
    });
    expect(planPasswordChange({ isGuest: true, newPassword: 'x'.repeat(201) })).toEqual({
      ok: false,
      reason: 'TOO_LONG',
    });
  });

  it('新舊密碼一樣 → 擋下', () => {
    expect(
      planPasswordChange({
        isGuest: false,
        currentPassword: 'same-password',
        newPassword: 'same-password',
      }),
    ).toEqual({ ok: false, reason: 'SAME_AS_CURRENT' });
  });
});

describe('mergePreferences', () => {
  it('是淺層合併，沒送的鍵不會被洗掉', () => {
    expect(mergePreferences({ locale: 'zh-TW', theme: 'dark' }, { theme: 'light' })).toEqual({
      locale: 'zh-TW',
      theme: 'light',
    });
  });

  it('沒有 patch 時原樣複製；壞掉的舊資料當成空物件', () => {
    expect(mergePreferences({ theme: 'dark' }, undefined)).toEqual({ theme: 'dark' });
    expect(mergePreferences(null, { startPage: 'last' })).toEqual({ startPage: 'last' });
    expect(mergePreferences([] as unknown as null, undefined)).toEqual({});
  });

  it('patch 裡的 undefined 不會覆蓋既有值', () => {
    expect(mergePreferences({ theme: 'dark' }, { theme: undefined })).toEqual({ theme: 'dark' });
  });
});

describe('summarizeSessions', () => {
  const row = (over: Partial<SessionFamilyRow> & { id: string; familyId: string }): SessionFamilyRow => ({
    userAgent: null,
    ip: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    expiresAt: new Date('2026-02-01T00:00:00Z'),
    ...over,
  });

  it('同一個家族的多次輪替收斂成一台裝置', () => {
    const list = summarizeSessions(
      [
        row({ id: 'a1', familyId: 'a', createdAt: new Date('2026-01-01T00:00:00Z'), userAgent: 'Chrome/1', ip: '1.1.1.1' }),
        row({ id: 'a2', familyId: 'a', createdAt: new Date('2026-01-03T00:00:00Z'), userAgent: 'Chrome/2' }),
      ],
      'a',
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'a',
      current: true,
      userAgent: 'Chrome/2',
      ip: '1.1.1.1',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: '2026-01-03T00:00:00.000Z',
    });
  });

  it('目前這台排第一，其餘照最後使用時間由新到舊', () => {
    const list = summarizeSessions(
      [
        row({ id: 'b1', familyId: 'b', createdAt: new Date('2026-01-05T00:00:00Z') }),
        row({ id: 'c1', familyId: 'c', createdAt: new Date('2026-01-09T00:00:00Z') }),
        row({ id: 'a1', familyId: 'a', createdAt: new Date('2026-01-01T00:00:00Z') }),
      ],
      'a',
    );
    expect(list.map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(list.filter((s) => s.current)).toHaveLength(1);
  });

  it('找不到目前家族時沒有任何一列是 current', () => {
    const list = summarizeSessions([row({ id: 'a1', familyId: 'a' })], null);
    expect(list[0]!.current).toBe(false);
  });
});

describe('pickOwnershipSuccessor', () => {
  const at = (iso: string) => new Date(iso);

  it('優先交給 admin，同級取最早加入的', () => {
    const successor = pickOwnershipSuccessor(
      [
        { userId: 'me', role: 'owner', joinedAt: at('2026-01-01T00:00:00Z') },
        { userId: 'm1', role: 'member', joinedAt: at('2026-01-02T00:00:00Z') },
        { userId: 'a2', role: 'admin', joinedAt: at('2026-01-05T00:00:00Z') },
        { userId: 'a1', role: 'admin', joinedAt: at('2026-01-03T00:00:00Z') },
      ],
      'me',
    );
    expect(successor?.userId).toBe('a1');
  });

  it('沒有 admin 就給 member，member 優於 guest', () => {
    const successor = pickOwnershipSuccessor(
      [
        { userId: 'me', role: 'owner', joinedAt: at('2026-01-01T00:00:00Z') },
        { userId: 'g1', role: 'guest', joinedAt: at('2026-01-02T00:00:00Z') },
        { userId: 'm1', role: 'member', joinedAt: at('2026-01-04T00:00:00Z') },
      ],
      'me',
    );
    expect(successor?.userId).toBe('m1');
  });

  it('只剩自己一個人 → null（工作區跟著軟刪）', () => {
    expect(
      pickOwnershipSuccessor([{ userId: 'me', role: 'owner', joinedAt: at('2026-01-01T00:00:00Z') }], 'me'),
    ).toBeNull();
    expect(pickOwnershipSuccessor([], 'me')).toBeNull();
  });
});

describe('deletedEmailFor', () => {
  it('讓出 email，但保留得出原本是誰', () => {
    const email = deletedEmailFor('ken@example.com', '0193b0f2-1111-7000-8000-000000000000');
    expect(email).toBe('ken+deleted-0193b0f2@example.com');
  });

  it('同一個信箱被不同帳號用過也不會撞在一起', () => {
    const a = deletedEmailFor('ken@example.com', 'aaaaaaaa-1111-7000-8000-000000000000');
    const b = deletedEmailFor('ken@example.com', 'bbbbbbbb-1111-7000-8000-000000000000');
    expect(a).not.toBe(b);
  });
});
