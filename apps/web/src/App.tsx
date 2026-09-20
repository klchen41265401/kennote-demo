import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './features/shell/AppShell';
import { registerDatabaseModule } from './features/database/register';
import { ErrorBoundary } from './features/shell/ErrorBoundary';
import { HomeRoute } from './features/home/HomeRoute';
import { DatabaseRoute } from './routes/DatabaseRoute';
import { InboxRoute } from './routes/InboxRoute';
import { LoginRoute } from './routes/LoginRoute';
import { NotFoundRoute } from './routes/NotFoundRoute';
import { PageRoute } from './routes/PageRoute';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { PublicPageRoute } from './routes/PublicPageRoute';
import { RegisterRoute } from './routes/RegisterRoute';
import { SettingsRoute } from './routes/SettingsRoute';

// 讓頁面裡的 collectionView block 真的畫出資料庫（見 features/database/register.tsx）
registerDatabaseModule();

export function App(): JSX.Element {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <RoutedBoundary>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/register" element={<RegisterRoute />} />
          {/* 公開分享頁：匿名可讀，不進 ProtectedRoute、不掛側邊欄 */}
          <Route path="/share/:token" element={<PublicPageRoute />} />

          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route index element={<HomeRoute />} />
              <Route path="inbox" element={<InboxRoute />} />
              <Route path="page/:pageId" element={<PageRoute />} />
              <Route path="database/:pageId" element={<DatabaseRoute />} />
              {/* 第十二輪 O-12：設定本來只是 store 裡的 overlay，`/settings` 會掉到 404 */}
              <Route path="settings" element={<SettingsRoute />} />
              <Route path="settings/:tab" element={<SettingsRoute />} />
              <Route path="*" element={<NotFoundRoute />} />
            </Route>
          </Route>
        </Routes>
      </RoutedBoundary>
    </BrowserRouter>
  );
}

/** 換頁時自動清掉錯誤狀態，否則一次 render 錯誤會把整個 App 卡死 */
function RoutedBoundary({ children }: { children: JSX.Element }): JSX.Element {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}
