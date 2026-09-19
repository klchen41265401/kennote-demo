import { describe, expect, it } from 'vitest';
import {
  classifyRefresh,
  decisionErrorCode,
  shouldRevokeFamily,
  type SessionRecord,
} from '../src/modules/auth/token-state.js';

const now = new Date('2026-09-19T00:00:00Z');
const session = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  userId: 'u1',
  familyId: 'f1',
  expiresAt: new Date('2026-10-19T00:00:00Z'),
  rotatedAt: null,
  revokedAt: null,
  ...patch,
});

describe('refresh token 狀態機', () => {
  it('正常的 token → VALID', () => {
    expect(classifyRefresh(session(), now)).toBe('VALID');
  });

  it('查不到 → INVALID（不透露是過期還是假造）', () => {
    expect(classifyRefresh(null, now)).toBe('INVALID');
    expect(classifyRefresh(undefined, now)).toBe('INVALID');
  });

  it('已撤銷 → REVOKED', () => {
    expect(classifyRefresh(session({ revokedAt: now }), now)).toBe('REVOKED');
  });

  it('已輪替過的 token 再被使用 → REUSED', () => {
    expect(classifyRefresh(session({ rotatedAt: now }), now)).toBe('REUSED');
  });

  it('已輪替且已過期 → 仍然是 REUSED（要藉此撤銷整個家族）', () => {
    const s = session({ rotatedAt: now, expiresAt: new Date('2026-09-18T00:00:00Z') });
    expect(classifyRefresh(s, now)).toBe('REUSED');
  });

  it('過期 → EXPIRED', () => {
    expect(classifyRefresh(session({ expiresAt: new Date('2026-09-18T00:00:00Z') }), now)).toBe(
      'EXPIRED',
    );
  });

  it('剛好到期的瞬間算過期', () => {
    expect(classifyRefresh(session({ expiresAt: now }), now)).toBe('EXPIRED');
  });

  it('只有 REUSED 會撤銷整個家族', () => {
    expect(shouldRevokeFamily('REUSED')).toBe(true);
    for (const d of ['VALID', 'INVALID', 'REVOKED', 'EXPIRED'] as const) {
      expect(shouldRevokeFamily(d)).toBe(false);
    }
  });

  it('錯誤碼對應', () => {
    expect(decisionErrorCode('REUSED')).toBe('SESSION_REUSED');
    expect(decisionErrorCode('EXPIRED')).toBe('SESSION_EXPIRED');
    expect(decisionErrorCode('REVOKED')).toBe('SESSION_EXPIRED');
  });
});
