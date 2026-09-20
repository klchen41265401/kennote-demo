/**
 * 認證。Demo 模式**永遠登入成功**，而且只有一個使用者。
 *
 * - `POST /api/auth/refresh`：一律成功（`bootstrapAuth()` 在開機時打這一支，
 *   所以「首次進站直接以 demo 使用者登入」不需要任何額外程式碼）
 * - `POST /api/auth/open` / `login` / `register`：不管輸入什麼都回同一個 demo 使用者
 * - `POST /api/auth/logout`：清掉 session（登入頁的「不輸入，直接進入」可以再進來）
 */
import type { AuthSessionResponse, AuthUser, WorkspaceSummary } from '@kennote/shared-types';
import { commit, db } from '../store';
import { currentUser, publicUser } from '../core';
import type { DemoHandler } from '../router';
import { DemoApiError, jsonOk, noContent, nowIso, uuid } from '../util';

export const DEMO_USER_ID = 'demo-user-0001';
export const DEMO_USER_EMAIL = 'demo@kennote.local';

export function ensureDemoUser(): AuthUser {
  const state = db();
  let user = state.users[DEMO_USER_ID];
  if (!user) {
    user = {
      id: DEMO_USER_ID,
      name: 'Demo 使用者',
      email: DEMO_USER_EMAIL,
      avatarUrl: null,
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
      emailVerified: true,
      createdAt: nowIso(),
      preferences: { locale: 'zh-TW', theme: 'system', startPage: 'home' },
    };
    state.users[DEMO_USER_ID] = user;
  }
  return user;
}

export function workspaceSummaries(): WorkspaceSummary[] {
  return Object.values(db().workspaces)
    .filter((w) => !w.deletedAt)
    .map((w) => ({ id: w.id, name: w.name, slug: w.slug, icon: w.icon, role: w.role }));
}

export function sessionResponse(): AuthSessionResponse {
  const user = ensureDemoUser();
  db().sessionUserId = user.id;
  commit();
  return {
    accessToken: `demo.${uuid()}`,
    expiresIn: 900,
    user,
    workspaces: workspaceSummaries(),
  };
}

const session: DemoHandler = () => jsonOk(sessionResponse());
const openLogin: DemoHandler = () => jsonOk({ ...sessionResponse(), mode: 'login', note: 'Demo 模式：資料只存在你的瀏覽器' });

export const authRoutes: Array<[string, DemoHandler]> = [
  ['POST /api/auth/refresh', session],
  ['POST /api/auth/login', session],
  ['POST /api/auth/register', session],
  ['POST /api/auth/open', openLogin],
  [
    'POST /api/auth/logout',
    () => {
      db().sessionUserId = null;
      commit();
      return jsonOk({ ok: true });
    },
  ],
  [
    'POST /api/auth/logout-all',
    () => {
      db().sessionUserId = null;
      commit();
      return jsonOk({ revokedSessions: 1 });
    },
  ],
  [
    'GET /api/auth/providers',
    () => jsonOk({ providers: [], openLogin: true }),
  ],
  ['GET /api/auth/me', () => jsonOk({ user: currentUser(), workspaces: workspaceSummaries() })],
  [
    'PATCH /api/auth/me',
    async (req) => {
      const patch = (await req.json<{
        name?: string;
        avatarUrl?: string | null;
        preferences?: Record<string, unknown>;
      }>()) ?? {};
      const user = currentUser();
      if (patch.name !== undefined) user.name = patch.name;
      if (patch.avatarUrl !== undefined) user.avatarUrl = patch.avatarUrl;
      if (patch.preferences) {
        user.preferences = { ...user.preferences, ...patch.preferences };
        if (typeof user.preferences.locale === 'string') user.locale = user.preferences.locale;
      }
      commit();
      return jsonOk(user);
    },
  ],
  [
    'DELETE /api/auth/me',
    () => {
      throw new DemoApiError(501, 'NOT_IMPLEMENTED', 'Demo 模式不能刪除帳號（請改用設定裡的「重設 Demo 資料」）');
    },
  ],
  ['POST /api/auth/password', () => jsonOk({ revokedSessions: 0 })],
  [
    'POST /api/auth/claim',
    () => jsonOk({ user: currentUser(), revokedSessions: 0 }),
  ],
  [
    'GET /api/auth/sessions',
    () => {
      const at = nowIso();
      return jsonOk([
        {
          id: 'demo-session',
          current: true,
          userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
          ip: null,
          createdAt: at,
          lastUsedAt: at,
          expiresAt: at,
        },
      ]);
    },
  ],
  ['DELETE /api/auth/sessions/:id', () => noContent()],
];

export { publicUser };
