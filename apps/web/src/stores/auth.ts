/**
 * 認證狀態。用 packages/ui 的自研 store（useSyncExternalStore），
 * 不用 zustand / redux —— check-deps.ts 會在 CI 擋下那些套件。
 */
import type {
  AuthSessionResponse,
  AuthUser,
  ChangePasswordRequest,
  ChangePasswordResponse,
  ClaimAccountRequest,
  ClaimAccountResponse,
  DeleteAccountResponse,
  LogoutAllResponse,
  MeResponse,
  UpdateProfileRequest,
  UserPreferences,
  WorkspaceSummary,
} from '@kennote/shared-types';
import { API_ROUTES, isGuestEmail, type OpenLoginResponse } from '@kennote/shared-types';
import { clearQueryCache, createStore, useStore } from '@kennote/ui';
import { api, refreshSession, setAccessToken, setUnauthorizedHandler } from '../lib/api-client';
import { applyTheme, type Theme } from '../lib/theme';

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
  applyUserPreferences(session.user.preferences);
}

/**
 * 把「跟著帳號走」的偏好套到這台裝置上（bootstrap 與每次登入都會跑一次）。
 *
 * 主題與起始頁面在 M3 時是純 localStorage；現在伺服器才是事實來源，
 * 但仍然**寫回 localStorage** —— lib/theme 與 features/onboarding/landing 都從那裡讀，
 * 而且下次開啟時在拿到 /refresh 回應之前就要有正確的主題（否則會閃一下白底）。
 */
export function applyUserPreferences(preferences: UserPreferences | undefined): void {
  if (!preferences) return;
  if (preferences.theme) applyTheme(preferences.theme as Theme);
  if (preferences.locale) {
    try {
      document.documentElement.lang = preferences.locale;
    } catch {
      /* 非瀏覽器環境（測試） */
    }
  }
  if (preferences.startPage) {
    try {
      localStorage.setItem('kennote:start-page', preferences.startPage);
    } catch {
      /* 無痕模式 */
    }
  }
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
  // ⚠️ 一定要走 api-client 的 `refreshSession()`（全 App 共用同一個 in-flight promise），
  // 不要自己 `api.post('/auth/refresh')` —— 開機時可能有請求在 token 還沒回來就送出去，
  // 它 401 之後也會去 refresh；兩次併發的 refresh 會被後端當成 token reuse 而
  // **撤銷整個 session 家族**（使用者直接被登出 → 冷啟動 `?p=` 的 side peek 會掉回登入頁）。
  const session = (await refreshSession()) as AuthSessionResponse | null;
  if (!session) {
    clearSession();
    return;
  }
  applySession(session);
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
  applyUserPreferences(me.user.preferences);
}

/* ────────────────────────────────────────────────────────────
 * 帳號設定（設定 Dialog 的「我的帳號 / 我的設定」）
 * ──────────────────────────────────────────────────────────── */

function setUser(user: AuthUser): void {
  authStore.setState((prev) => ({ ...prev, user }));
}

/** 改名稱 / 頭像 / 偏好。preferences 是淺層合併，只送要改的鍵 */
export async function updateProfile(patch: UpdateProfileRequest): Promise<AuthUser> {
  const user = await api.patch<AuthUser>(API_ROUTES.me, patch);
  setUser(user);
  applyUserPreferences(user.preferences);
  return user;
}

/** 只改偏好的捷徑（設定頁的下拉選單邊改邊存） */
export async function updatePreferences(preferences: UserPreferences): Promise<AuthUser> {
  return updateProfile({ preferences });
}

/** 改密碼。成功後其他裝置會被登出，目前這一台留著 */
export async function changePassword(
  input: ChangePasswordRequest,
): Promise<ChangePasswordResponse> {
  return api.post<ChangePasswordResponse>(API_ROUTES.authPassword, input);
}

/** 訪客帳號升級成正式帳號：資料留著，之後可以用 email + 密碼登入 */
export async function claimAccount(input: ClaimAccountRequest): Promise<ClaimAccountResponse> {
  const result = await api.post<ClaimAccountResponse>(API_ROUTES.authClaim, input);
  setUser(result.user);
  return result;
}

/** 登出所有裝置（含這一台）→ 清空本機狀態，ProtectedRoute 會把人帶回登入頁 */
export async function logoutAll(): Promise<LogoutAllResponse> {
  try {
    return await api.post<LogoutAllResponse>(API_ROUTES.authLogoutAll);
  } finally {
    clearSession();
  }
}

/** 刪除帳號（軟刪除 + 撤銷所有 session）。confirm 走 query string，api-client 的 DELETE 不帶 body */
export async function deleteAccount(): Promise<DeleteAccountResponse> {
  // 失敗時**不要**清狀態 —— 帳號還在，把人登出只會讓他以為刪掉了
  const result = await api.delete<DeleteAccountResponse>(`${API_ROUTES.me}?confirm=DELETE`);
  clearSession();
  return result;
}

/** 訪客帳號（FEATURE_OPEN_LOGIN 隨手發的）→ 設定頁顯示「保留資料」提示卡 */
export function isGuestAccount(user: AuthUser | null): boolean {
  return isGuestEmail(user?.email);
}

export function useAuth(): AuthState {
  return useStore(authStore);
}

/** 目前選到的工作區（MVP：就是第一個） */
export function useCurrentWorkspace(): WorkspaceSummary | null {
  const { workspaces } = useAuth();
  return workspaces[0] ?? null;
}
