/**
 * 關聯列標題的極簡快取。
 *
 * 後端回傳的 relation 值只有 pageIds（真值），沒有標題。
 * 為了不讓每個儲存格各發一次請求，picker 抓回來的標題存在這裡，
 * 儲存格直接讀。抓不到就退回顯示 id 的前 8 碼（不會是空白）。
 */
const titles = new Map<string, string>();

export function rememberTitles(entries: Array<{ id: string; title: string }>): void {
  for (const entry of entries) titles.set(entry.id, entry.title);
}

export function relatedTitle(id: string): string {
  return titles.get(id) ?? id.slice(0, 8);
}
