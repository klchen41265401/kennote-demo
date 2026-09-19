import { Navigate, useNavigate } from 'react-router-dom';
import { AuthForm } from '../features/auth/AuthForm';
import { register, useAuth } from '../stores/auth';

export function RegisterRoute() {
  const { status } = useAuth();
  const navigate = useNavigate();

  if (status === 'authenticated') return <Navigate to="/" replace />;

  return (
    <AuthForm
      mode="register"
      onSubmit={async ({ email, password, name }) => {
        await register(email, password, name);
        navigate('/', { replace: true });
      }}
    />
  );
}
