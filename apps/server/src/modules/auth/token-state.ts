/**
 * Refresh token 輪替（rotation）與重用偵測的**純狀態機**。
 *
 * 刻意不碰資料庫、不碰 env —— 這是整個認證流程裡最容易寫錯、
 * 也最該被單元測試釘死的一段（00-README 第一週驗收標準第 2 條）。
 *
 * 規則（04 §5.5）：
 *   1. token 不存在            → INVALID（不透露是過期還是假造）
 *   2. 整個 family 已被撤銷    → REVOKED
 *   3. token 已被輪替過        → REUSED：整個 session 家族立刻撤銷
 *   4. token 過期              → EXPIRED
 *   5. 其餘                    → VALID：輪替出新 token，舊的標記 rotated_at
 */

export type RefreshDecision = 'VALID' | 'INVALID' | 'REVOKED' | 'REUSED' | 'EXPIRED';

export interface SessionRecord {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
}

export function classifyRefresh(
  session: SessionRecord | null | undefined,
  now: Date = new Date(),
): RefreshDecision {
  if (!session) return 'INVALID';
  if (session.revokedAt !== null) return 'REVOKED';
  // 順序很重要：已輪替的 token 就算過期了也要算成 REUSED，
  // 因為攻擊者拿到的就是舊 token，我們要藉此撤銷整個家族。
  if (session.rotatedAt !== null) return 'REUSED';
  if (session.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'VALID';
}

/** REUSED 必須撤銷整個家族；其他失敗情況不需要 */
export function shouldRevokeFamily(decision: RefreshDecision): boolean {
  return decision === 'REUSED';
}

/** 決策 → 對外錯誤碼 */
export function decisionErrorCode(
  decision: Exclude<RefreshDecision, 'VALID'>,
): 'SESSION_REUSED' | 'SESSION_EXPIRED' {
  return decision === 'REUSED' ? 'SESSION_REUSED' : 'SESSION_EXPIRED';
}
