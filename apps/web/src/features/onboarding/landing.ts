/**
 * Onboarding / 登入後的落點（01 §3、04 §8 M3）。
 *
 * 後端註冊時已經自動建立預設工作區 + 範例頁（「歡迎使用 kennote」seed），
 * 所以前端這裡只要決定「登入之後要落在哪一頁」：
 *   - 設定成「上次造訪的頁面」而且那一頁還在 → /page/<id>
 *   - 否則 → 首頁
 */
import { getLastPage } from '../../stores/ui';

export type StartPagePreference = 'home' | 'last';

export function getStartPreference(): StartPagePreference {
  try {
    return localStorage.getItem('kennote:start-page') === 'last' ? 'last' : 'home';
  } catch {
    return 'home';
  }
}

/** 登入 / 重新整理之後應該去的路徑 */
export function landingPath(): string {
  if (getStartPreference() !== 'last') return '/';
  const last = getLastPage();
  return last ? `/page/${last}` : '/';
}

/** 新註冊的使用者一律落在首頁（範例頁就在側邊欄裡，讓他自己點） */
export function firstRunPath(): string {
  return '/';
}
