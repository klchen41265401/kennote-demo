/**
 * 裝置清單的顯示輔助（純函式，可單獨測試）。
 * GET /api/auth/sessions 回的是原始 UA 字串與 ISO 時間，設定頁只需要人看得懂的版本。
 */

/** UA 字串太長，設定頁只需要「什麼瀏覽器・什麼系統」 */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return '未知裝置';
  // 順序有意義：Edge / Opera 的 UA 裡也有 Chrome，Chrome 的 UA 裡也有 Safari
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\/|Opera/.test(userAgent)
      ? 'Opera'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : '瀏覽器';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad|iPod|iOS/.test(userAgent)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '未知系統';
  return `${browser}・${os}`;
}

export function formatSessionTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
