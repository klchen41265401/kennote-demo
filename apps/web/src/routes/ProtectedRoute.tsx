import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../stores/auth';
import styles from './ProtectedRoute.module.css';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className={styles.splash} role="status" aria-live="polite">
        <span className={styles.spinner} aria-hidden="true" />
        <span className={styles.label}>載入中…</span>
      </div>
    );
  }

  if (status === 'anonymous') {
    // ⚠️ 要連 query 一起帶走：side peek 是 URL 狀態（`?p=&pm=`），
    // 只存 pathname 的話「session 過期 → 登入 → 回來」會把 peek 弄丟。
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }

  return <Outlet />;
}
