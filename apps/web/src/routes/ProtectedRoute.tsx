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
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
