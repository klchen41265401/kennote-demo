/** 主題切換：寫 <html data-theme>，沒設定過就跟隨系統（02 §6） */
export type Theme = 'light' | 'dark' | 'system';

const KEY = 'kennote:theme';

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* 無痕模式：忽略 */
  }
}

export function initTheme(): void {
  applyTheme(getTheme());
}

export function toggleTheme(): Theme {
  const current = document.documentElement.getAttribute('data-theme');
  const next: Theme =
    current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark';
  applyTheme(next);
  return next;
}
