import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LoginRoute } from './routes/LoginRoute';
import { PageRoute } from './routes/PageRoute';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { RegisterRoute } from './routes/RegisterRoute';
import { WorkspaceRoute } from './routes/WorkspaceRoute';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/register" element={<RegisterRoute />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<WorkspaceRoute />}>
            <Route index element={<PageRoute />} />
            <Route path="page/:pageId" element={<PageRoute />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
