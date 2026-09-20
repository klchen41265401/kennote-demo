/**
 * `/settings` 與 `/settings/:tab`（第十二輪，O-12）。
 *
 * 在這之前設定只是 `stores/ui` 裡的一個 overlay，**沒有對應的網址**：
 * `/settings` 會掉到 `NotFoundRoute`，於是
 *   · 使用者把設定頁加到書籤 → 下次打開是 404
 *   · 文件 / 客服寫「到 /settings/members 邀請成員」→ 講不通
 *   · 重新整理會把正在填的分頁丟掉
 *
 * ⭐ 做法是**讓網址驅動既有的 overlay**，不是再做一份設定畫面：
 * 設定 UI 只有 `SettingsDialog` 一份（`AppShell` 在 `overlay === 'settings'`
 * 時渲染它），這裡只負責「把網址翻成 store 狀態」與「把關閉翻回網址」。
 * 多做一份會變成兩個入口寫同一張表、行為卻不一樣
 *（第十一輪 §3-3「接線之前先找這件事是不是已經有地方做了」）。
 *
 * 底下仍然畫首頁：overlay 是半透明蓋在內容上的，redirect 到 `/` 會把
 * 網址丟掉（那就等於沒修），留在 `/settings/:tab` 才是可分享的連結。
 */
import { useEffect, useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { HomeRoute } from '../features/home/HomeRoute';
import { closeOverlay, openOverlay, useUi } from '../stores/ui';

/** 網址上認得的分頁，與 `SettingsDialog` 的 NAV 一致 */
const TABS = [
  'account',
  'preferences',
  'notifications',
  'members',
  'workspace',
  'importExport',
] as const;

export function SettingsRoute(): JSX.Element {
  const { tab } = useParams<{ tab?: string }>();
  const ui = useUi();
  const navigate = useNavigate();
  const valid = tab === undefined || (TABS as readonly string[]).includes(tab);

  useEffect(() => {
    if (!valid) return;
    openOverlay('settings', { settingsTab: tab ?? 'account' });
    // 卸載時收掉 overlay，否則「上一頁」離開 /settings 之後設定還蓋在畫面上
    return () => closeOverlay();
    // tab 變了要跟著換分頁；overlay 本身不進相依陣列（使用者在對話框裡切分頁
    // 只改 store，不該把網址改回去 —— 那會在每一次點擊都推一筆歷史紀錄）
  }, [tab, valid]);

  /*
   * ⚠️ 這個 ref 不能省。兩個 effect 是在**同一次 render 之後**依序跑的，
   * 而第二個 effect 讀到的 `ui.overlay` 還是那一次 render 的快照 —— 也就是
   * `null`。少了這個旗標，掛載的瞬間就會「偵測到使用者關掉了設定」
   * 並 redirect 回首頁，於是 `/settings` 看起來完全沒有作用
   *（實測就是這樣：R12-8 第一次跑是紅的）。
   *
   * **「狀態還沒被設起來」與「使用者把它關掉了」在同一個值上長得一模一樣，**
   * 要分開就得記住自己曾經看過它是開的。
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!valid) return;
    if (ui.overlay === 'settings') {
      wasOpen.current = true;
      return;
    }
    // 在 /settings 上把對話框關掉（X / Esc）→ 網址也要跟著離開，
    // 不然重新整理又會回到設定，而且「關閉」看起來沒有生效。
    if (wasOpen.current && ui.overlay === null) navigate('/', { replace: true });
  }, [ui.overlay, valid, navigate]);

  // 不認得的分頁名（打錯字、舊連結）→ 回到預設分頁，不要給 404：
  // 使用者要的是「設定」，分頁名對不上不該變成「找不到這個頁面」。
  if (!valid) return <Navigate to="/settings" replace />;

  return <HomeRoute />;
}
