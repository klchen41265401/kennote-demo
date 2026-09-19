/**
 * 帳號設定端點的整合測試（PATCH /me、密碼、claim、sessions、logout-all、DELETE /me）。
 * 需要真的 PostgreSQL（DATABASE_URL_TEST）；沒有就整組 skip（04 §9）。
 *
 * 跑法：
 *   DATABASE_URL_TEST=postgres://kennote:kennote@localhost:5432/kennote_test \
 *   pnpm --filter @kennote/server migrate && pnpm --filter @kennote/server test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  AuthSessionResponse,
  AuthUser,
  MeResponse,
  SessionInfo,
} from '@kennote/shared-types';

const HAS_DB = Boolean(process.env.DATABASE_URL_TEST);

interface Injected {
  status: number;
  body: unknown;
  cookie: string | null;
}

describe.skipIf(!HAS_DB)('帳號設定端點', () => {
  let app: FastifyInstance;
  let closePool: () => Promise<void>;

  /**
   * 每個請求給一個獨一無二的來源 IP。
   * /register、/login、/password 這些端點都有「每分鐘 10 次」的 rate limit，
   * 而 rate limit 是以 IP 分桶的 —— 不這樣做，整組測試跑到一半就會開始收 429
   * （app 的 trustProxy 為 true，所以 x-forwarded-for 就是 req.ip）。
   */
  let ipSeq = 0;
  const nextIp = (): string => {
    ipSeq += 1;
    return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
  };

  const call = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    opts: { token?: string; cookie?: string; body?: unknown } = {},
  ): Promise<Injected> => {
    const res = await app.inject({
      method,
      url,
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
      headers: {
        'x-forwarded-for': nextIp(),
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
    });
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const rt = list.find((c) => c.startsWith('kennote_rt='));
    let body: unknown = null;
    try {
      body = res.json();
    } catch {
      body = null;
    }
    return { status: res.statusCode, body, cookie: rt ? rt.split(';')[0]! : null };
  };

  const data = <T>(res: Injected): T => (res.body as { data: T }).data;

  /** 每個測試自己開一個全新帳號，彼此不干擾 */
  const newUser = async (opts: { email?: string } = {}) => {
    const email = opts.email ?? `acct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@kennote.test`;
    const password = 'original-password';
    const res = await call('POST', '/api/auth/register', {
      body: { email, password, name: '測試使用者' },
    });
    expect(res.status).toBe(201);
    const session = data<AuthSessionResponse>(res);
    return { email, password, token: session.accessToken, cookie: res.cookie!, user: session.user };
  };

  /** 同一個帳號再登入一次 = 另一台裝置（另一個 session 家族） */
  const loginAgain = async (email: string, password: string) => {
    const res = await call('POST', '/api/auth/login', { body: { email, password } });
    expect(res.status).toBe(200);
    return { token: data<AuthSessionResponse>(res).accessToken, cookie: res.cookie! };
  };

  beforeAll(async () => {
    const { buildApp } = await import('../src/app.js');
    ({ closePool } = await import('../src/db/client.js'));
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (closePool) await closePool();
  });

  /* ── PATCH /api/auth/me ──────────────────────────────── */

  it('PATCH /me 改名稱、頭像與偏好，偏好是淺層合併', async () => {
    const me = await newUser();

    const first = await call('PATCH', '/api/auth/me', {
      token: me.token,
      body: { name: '阿肯', avatarUrl: '/api/files/abc', preferences: { theme: 'dark', locale: 'zh-TW' } },
    });
    expect(first.status).toBe(200);
    expect(data<AuthUser>(first)).toMatchObject({
      name: '阿肯',
      avatarUrl: '/api/files/abc',
      preferences: { theme: 'dark', locale: 'zh-TW' },
    });

    const second = await call('PATCH', '/api/auth/me', {
      token: me.token,
      body: { preferences: { startPage: 'last' } },
    });
    expect(data<AuthUser>(second).preferences).toEqual({
      theme: 'dark',
      locale: 'zh-TW',
      startPage: 'last',
    });

    // GET /me 也要看得到（前端 bootstrap 靠這條套用偏好）
    const fetched = await call('GET', '/api/auth/me', { token: me.token });
    expect(data<MeResponse>(fetched).user.preferences).toMatchObject({ theme: 'dark' });
  });

  it('PATCH /me 擋掉 javascript: 之類的頭像網址與空名稱', async () => {
    const me = await newUser();
    const bad = await call('PATCH', '/api/auth/me', {
      token: me.token,
      body: { avatarUrl: 'javascript:alert(1)' },
    });
    expect(bad.status).toBe(400);
    const empty = await call('PATCH', '/api/auth/me', { token: me.token, body: { name: '   ' } });
    expect(empty.status).toBe(400);
  });

  it('PATCH /me 沒帶 token → 401', async () => {
    const res = await call('PATCH', '/api/auth/me', { body: { name: 'x' } });
    expect(res.status).toBe(401);
  });

  /* ── POST /api/auth/password ─────────────────────────── */

  it('改密碼要驗舊密碼，成功後撤銷其他裝置但留著自己', async () => {
    const me = await newUser();
    const other = await loginAgain(me.email, me.password);

    const wrong = await call('POST', '/api/auth/password', {
      token: me.token,
      body: { currentPassword: 'wrong-password', newPassword: 'brand-new-password' },
    });
    expect(wrong.status).toBe(401);

    const ok = await call('POST', '/api/auth/password', {
      token: me.token,
      body: { currentPassword: me.password, newPassword: 'brand-new-password' },
    });
    expect(ok.status).toBe(200);
    expect(data<{ revokedSessions: number }>(ok).revokedSessions).toBeGreaterThanOrEqual(1);

    // 自己還在
    expect((await call('GET', '/api/auth/me', { token: me.token })).status).toBe(200);
    // 另一台被踢掉
    expect((await call('GET', '/api/auth/me', { token: other.token })).status).toBe(401);
    // 新密碼可以登入，舊的不行
    expect((await call('POST', '/api/auth/login', { body: { email: me.email, password: 'brand-new-password' } })).status).toBe(200);
    expect((await call('POST', '/api/auth/login', { body: { email: me.email, password: me.password } })).status).toBe(401);
  });

  it('正式帳號不給舊密碼 → 400；訪客帳號可以直接設定', async () => {
    const me = await newUser();
    const noCurrent = await call('POST', '/api/auth/password', {
      token: me.token,
      body: { newPassword: 'brand-new-password' },
    });
    expect(noCurrent.status).toBe(400);

    const guest = await newUser({
      email: `guest-${Math.random().toString(36).slice(2, 10)}@guest.kennote.local`,
    });
    const set = await call('POST', '/api/auth/password', {
      token: guest.token,
      body: { newPassword: 'guest-new-password' },
    });
    expect(set.status).toBe(200);
  });

  /* ── POST /api/auth/claim ────────────────────────────── */

  it('訪客升級成正式帳號後，可以用新 email + 密碼登入', async () => {
    const guest = await newUser({
      email: `guest-${Math.random().toString(36).slice(2, 10)}@guest.kennote.local`,
    });
    const email = `claimed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@kennote.test`;

    const res = await call('POST', '/api/auth/claim', {
      token: guest.token,
      body: { email, password: 'claimed-password', name: '正式使用者' },
    });
    expect(res.status).toBe(200);
    const claimed = data<{ user: AuthUser }>(res);
    expect(claimed.user.email).toBe(email);
    expect(claimed.user.name).toBe('正式使用者');

    const login = await call('POST', '/api/auth/login', { body: { email, password: 'claimed-password' } });
    expect(login.status).toBe(200);
    // 同一個帳號（資料原封不動留著）
    expect(data<AuthSessionResponse>(login).user.id).toBe(guest.user.id);

    // 已經是正式帳號 → 再 claim 一次要被擋
    const again = await call('POST', '/api/auth/claim', {
      token: guest.token,
      body: { email: `x-${Date.now()}@kennote.test`, password: 'another-password' },
    });
    expect(again.status).toBe(409);
  });

  it('claim 用了別人已經註冊的 email → 409 EMAIL_TAKEN', async () => {
    const taken = await newUser();
    const guest = await newUser({
      email: `guest-${Math.random().toString(36).slice(2, 10)}@guest.kennote.local`,
    });
    const res = await call('POST', '/api/auth/claim', {
      token: guest.token,
      body: { email: taken.email, password: 'whatever-password' },
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('EMAIL_TAKEN');
  });

  /* ── sessions ────────────────────────────────────────── */

  it('GET /sessions 一台裝置一列，目前這台排第一且標記 current', async () => {
    const me = await newUser();
    await loginAgain(me.email, me.password);

    const res = await call('GET', '/api/auth/sessions', { token: me.token });
    expect(res.status).toBe(200);
    const list = data<SessionInfo[]>(res);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]!.current).toBe(true);
    expect(list.filter((s) => s.current)).toHaveLength(1);
  });

  it('refresh 輪替不會多長出一台裝置', async () => {
    const me = await newUser();
    const before = data<SessionInfo[]>(await call('GET', '/api/auth/sessions', { token: me.token })).length;

    const refreshed = await call('POST', '/api/auth/refresh', { cookie: me.cookie });
    expect(refreshed.status).toBe(200);
    const token = data<AuthSessionResponse>(refreshed).accessToken;

    const after = data<SessionInfo[]>(await call('GET', '/api/auth/sessions', { token })).length;
    expect(after).toBe(before);
  });

  it('DELETE /sessions/:id 踢掉指定裝置', async () => {
    const me = await newUser();
    const other = await loginAgain(me.email, me.password);

    const list = data<SessionInfo[]>(await call('GET', '/api/auth/sessions', { token: me.token }));
    const target = list.find((s) => !s.current)!;
    const res = await call('DELETE', `/api/auth/sessions/${target.id}`, { token: me.token });
    expect(res.status).toBe(200);

    expect((await call('GET', '/api/auth/me', { token: other.token })).status).toBe(401);
    expect((await call('GET', '/api/auth/me', { token: me.token })).status).toBe(200);
  });

  it('不能踢掉別人的裝置', async () => {
    const me = await newUser();
    const victim = await newUser();
    const list = data<SessionInfo[]>(await call('GET', '/api/auth/sessions', { token: victim.token }));
    const res = await call('DELETE', `/api/auth/sessions/${list[0]!.id}`, { token: me.token });
    expect(res.status).toBe(404);
    expect((await call('GET', '/api/auth/me', { token: victim.token })).status).toBe(200);
  });

  /* ── logout-all ──────────────────────────────────────── */

  it('POST /logout-all 連自己這一台一起登出', async () => {
    const me = await newUser();
    const other = await loginAgain(me.email, me.password);

    const res = await call('POST', '/api/auth/logout-all', { token: me.token });
    expect(res.status).toBe(200);
    expect(data<{ revokedSessions: number }>(res).revokedSessions).toBeGreaterThanOrEqual(2);

    expect((await call('GET', '/api/auth/me', { token: me.token })).status).toBe(401);
    expect((await call('GET', '/api/auth/me', { token: other.token })).status).toBe(401);
    // refresh cookie 也失效 → 重新整理不會偷偷續命
    expect((await call('POST', '/api/auth/refresh', { cookie: me.cookie })).status).toBe(401);
  });

  /* ── DELETE /api/auth/me ─────────────────────────────── */

  it('刪除帳號要二次確認，成功後所有 session 失效且 email 讓出來', async () => {
    const me = await newUser();

    const missing = await call('DELETE', '/api/auth/me', { token: me.token });
    expect(missing.status).toBe(400);
    expect((await call('GET', '/api/auth/me', { token: me.token })).status).toBe(200);

    const res = await call('DELETE', '/api/auth/me', { token: me.token, body: { confirm: 'DELETE' } });
    expect(res.status).toBe(200);
    // 只有自己一個人的工作區 → 一併軟刪
    expect(data<{ deletedWorkspaces: string[] }>(res).deletedWorkspaces.length).toBeGreaterThanOrEqual(1);

    expect((await call('GET', '/api/auth/me', { token: me.token })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { body: { email: me.email, password: me.password } })).status).toBe(401);
    // 同一個信箱可以重新註冊
    const again = await call('POST', '/api/auth/register', {
      body: { email: me.email, password: 'fresh-password' },
    });
    expect(again.status).toBe(201);
  });

  it('DELETE /me 也吃 query string 的 confirm（前端 api-client 不帶 body）', async () => {
    const me = await newUser();
    const res = await call('DELETE', '/api/auth/me?confirm=DELETE', { token: me.token });
    expect(res.status).toBe(200);
  });

  it('owner 的工作區還有其他成員時交接出去，不會被刪掉', async () => {
    const owner = await newUser();
    const mate = await newUser();

    const { db } = await import('../src/db/client.js');
    const { sql } = await import('../src/db/sql.js');
    const ws = data<MeResponse>(await call('GET', '/api/auth/me', { token: owner.token })).workspaces[0]!;
    await db.query(sql`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${ws.id}, ${mate.user.id}, 'admin')
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'admin', deleted_at = NULL
    `);

    const res = await call('DELETE', '/api/auth/me', { token: owner.token, body: { confirm: 'DELETE' } });
    expect(res.status).toBe(200);
    expect(data<{ transferredWorkspaces: string[] }>(res).transferredWorkspaces).toContain(ws.id);

    const mateWorkspaces = data<MeResponse>(await call('GET', '/api/auth/me', { token: mate.token })).workspaces;
    expect(mateWorkspaces.find((w) => w.id === ws.id)?.role).toBe('owner');
  });
});
