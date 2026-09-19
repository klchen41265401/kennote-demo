/**
 * 認證狀態。用 packages/ui 的自研 store（useSyncExternalStore），
 * 不用 zustand / redux —— check-deps.ts 會在 CI 擋下那些套件。
 */
import type { AuthSessionResponse, AuthUser, MeResponse, WorkspaceSummary } from '@kennote/shared-types';
import { API_ROUTES, type OpenLoginResponse } from '@kennote/shared-types';
import { clearQueryCache, createStore, useStore } from '@kennote/ui';
import { api, setAccessToken, setUnauthorizedHandler } from '../lib/api-client';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  workspaces: WorkspaceSummary[];
}

export const authStore = createStore<AuthState>({
  status: 'loading',
  user: null,
  workspaces: [],
});

function applySession(session: AuthSessionResponse): void {
  setAccessToken(session.accessToken);
  authStore.setState({
    status: 'authenticated',
    user: session.user,
    workspaces: session.workspaces,
  });
}

function clearSession(): void {
  setAccessToken(null);
  clearQueryCache();
  authStore.setState({ status: 'anonymous', user: null, workspaces: [] });
}

// api-client 在 refresh 也失敗時會呼叫這個
setUnauthorizedHandler(() => {
  if (authStore.getState().status !== 'anonymous') clearSession();
});

/**
 * 開機時把登入狀態撿回來：
 * access token 只在記憶體，重新整理必然消失，但 refresh cookie 還在 →
 * 打一次 /refresh 就能無痛續命（「關瀏覽器再開仍保持登入」的驗收條件）。
 */
export async function bootstrapAuth(): Promise<void> {
  try {
    const session = await api.post<AuthSessionResponse>(API_ROUTES.refresh);
    applySession(session);
  } catch {
    clearSession();
  }
}

export async function login(email: string, password: string): Promise<void> {
  const session = await api.post<AuthSessionResponse>(API_ROUTES.login, { email, password });
  clearQueryCache();
  applySession(session);
}

/** 開放登入：不輸入或隨便輸入都能進（伺服器 FEATURE_OPEN_LOGIN） */
export async function openLogin(email: string, password: string): Promise<OpenLoginResponse> {
  const session = await api.post<OpenLoginResponse>(API_ROUTES.authOpen, {
    ...(email ? { email } : {}),
    ...(password ? { password } : {}),
  });
  clearQueryCache();
  applySession(session);
  return session;
}

export async function register(email: string, password: string, name?: string): Promise<void> {
  const session = await api.post<AuthSessionResponse>(API_ROUTES.register, {
    email,
    password,
    ...(name ? { name } : {}),
  });
  clearQueryCache();
  applySession(session);
}

export async function logout(): Promise<void> {
  try {
    await api.post(API_ROUTES.logout);
  } finally {
    clearSession();
  }
}

export async function reloadMe(): Promise<void> {
  const me = await api.get<MeResponse>(API_ROUTES.me);
  authStore.setState((prev) => ({ ...prev, user: me.user, workspaces: me.workspaces }));
}

export function useAuth(): AuthState {
  return useStore(authStore);
}

/** 目前選到的工作區（MVP：就是第一個） */
export function useCurrentWorkspace(): WorkspaceSummary | null {
  const { workspaces } = useAuth();
  return workspaces[0] ?? null;
}
