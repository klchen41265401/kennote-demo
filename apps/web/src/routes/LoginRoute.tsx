import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AuthForm } from '../features/auth/AuthForm';
import { login, useAuth } from '../stores/auth';
import { landingPath } from '../features/onboarding/landing';

export function LoginRoute() {
  const { status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  /*
   * `ProtectedRoute` 被擋下來時會把原本的網址（含 query）放在 `state.from`。
   * 登入成功就送回那裡 —— 否則「session 過期 → 登入 → 落在首頁」會把使用者
   * 正在看的東西（例如 side peek 的 `?p=&pm=`）整個弄丟。沒有 `from` 才走 landingPath()。
   */
  const from = (location.state as { from?: unknown } | null)?.from;
  // `//evil.example` 是通訊協定相對網址，會跳出站台 —— 只收單一斜線開頭的站內路徑
  const safe = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//');
  const target = safe ? (from as string) : landingPath();

  if (status === 'authenticated') return <Navigate to={target} replace />;

  return (
    <AuthForm
      mode="login"
      onSubmit={async ({ email, password }) => {
        await login(email, password);
        navigate(target, { replace: true });
      }}
    />
  );
}
