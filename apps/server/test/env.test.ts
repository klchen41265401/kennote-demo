import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/env.js';

const minimal = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(48),
};

describe('env 驗證', () => {
  it('最小設定可以通過，並套用預設值', () => {
    const result = parseEnv(minimal);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.SERVER_PORT).toBe(4000);
      expect(result.env.NODE_ENV).toBe('development');
      expect(result.env.JWT_ACCESS_TTL_SECONDS).toBe(900);
      expect(result.env.STORAGE_DRIVER).toBe('local');
      expect(result.env.CORS_ORIGINS).toEqual([]);
    }
  });

  it('缺必填變數時，回報變數名稱與說明', () => {
    const result = parseEnv({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const names = result.issues.map((i) => i.name);
      expect(names).toContain('DATABASE_URL');
      expect(names).toContain('JWT_SECRET');
      for (const issue of result.issues) {
        expect(issue.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('JWT_SECRET 太短會被擋下', () => {
    const result = parseEnv({ ...minimal, JWT_SECRET: 'short' });
    expect(result.ok).toBe(false);
  });

  it('DATABASE_URL 格式錯誤會被擋下', () => {
    const result = parseEnv({ ...minimal, DATABASE_URL: 'mysql://x' });
    expect(result.ok).toBe(false);
  });

  it('CORS_ORIGINS 會被切成陣列', () => {
    const result = parseEnv({ ...minimal, CORS_ORIGINS: 'http://a.com, http://b.com' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.env.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });

  it('布林值接受 true / 1', () => {
    const result = parseEnv({ ...minimal, FEATURE_OT: '1', COOKIE_SECURE: 'true' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.FEATURE_OT).toBe(true);
      expect(result.env.COOKIE_SECURE).toBe(true);
    }
  });
});
