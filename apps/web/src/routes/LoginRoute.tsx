import { Navigate, useNavigate } from 'react-router-dom';
import { AuthForm } from '../features/auth/AuthForm';
import { login, useAuth } from '../stores/auth';
import { landingPath } from '../features/onboarding/landing';

export function LoginRoute() {
  const { status } = useAuth();
  const navigate = useNavigate();

  if (status === 'authenticated') return <Navigate to={landingPath()} replace />;

  return (
    <AuthForm
      mode="login"
      onSubmit={async ({ email, password }) => {
        await login(email, password);
        navigate(landingPath(), { replace: true });
      }}
    />
  );
}
