/**
 * 密碼雜湊。密碼學絕不自研（00-README 決策 #3）。
 *
 * 介面刻意只有 hashPassword / verifyPassword 兩支 —— 之後若要換實作
 * （@node-rs/argon2、或平台不支援時退回 scrypt），只改這個檔案。
 * 參數依 OWASP Password Storage Cheat Sheet 的 argon2id 建議值。
 */
import argon2 from 'argon2';

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // 雜湊格式不合法（例如資料被手改過）→ 一律視為驗證失敗，不要往外拋
    return false;
  }
}

/** 密碼強度最低要求；註冊/改密碼共用 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;
