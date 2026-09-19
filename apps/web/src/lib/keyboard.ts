/**
 * 鍵盤事件 → 正規化字串（"mod+shift+k"）的純函式。
 * 不碰 React、不碰 document，單元測試可直接餵假事件。
 */

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

/** 把使用者按下的鍵正規化：mac 的 ⌘ 與 win 的 Ctrl 一律叫 `mod` */
export function eventToCombo(e: KeyLike): string {
  const parts: string[] = [];
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (mod) parts.push('mod');
  // 沒被當成 mod 的那一顆修飾鍵仍要如實記錄（例如 mac 上單獨的 Ctrl）
  if (IS_MAC ? e.ctrlKey : e.metaKey) parts.push('meta');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(normalizeKey(e.key));
  return parts.join('+');
}

export function normalizeKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'space';
  if (key.length === 1) return key.toLowerCase();
  switch (key) {
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'Escape':
      return 'esc';
    case 'Enter':
      return 'enter';
    case ' ':
      return 'space';
    default:
      return key.toLowerCase();
  }
}

/** 把定義字串正規化成與 eventToCombo 相同的排列（順序無關、大小寫無關） */
export function normalizeCombo(combo: string): string {
  const raw = combo
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  const set = new Set(raw);
  const key = raw[raw.length - 1] ?? '';
  const parts: string[] = [];
  if (set.has('mod') || set.has('cmd') || set.has('ctrl')) parts.push('mod');
  if (set.has('meta') && !set.has('mod')) parts.push('meta');
  if (set.has('alt') || set.has('option')) parts.push('alt');
  if (set.has('shift')) parts.push('shift');
  parts.push(key === 'escape' ? 'esc' : key);
  return parts.join('+');
}

export function matches(e: KeyLike, combo: string): boolean {
  return eventToCombo(e) === normalizeCombo(combo);
}

/** 顯示用（⌘K / Ctrl+K） */
export function formatCombo(combo: string): string {
  const parts = normalizeCombo(combo).split('+');
  const key = parts.pop() ?? '';
  const out: string[] = [];
  for (const p of parts) {
    if (p === 'mod') out.push(IS_MAC ? '⌘' : 'Ctrl');
    else if (p === 'meta') out.push(IS_MAC ? 'Ctrl' : 'Win');
    else if (p === 'alt') out.push(IS_MAC ? '⌥' : 'Alt');
    else if (p === 'shift') out.push(IS_MAC ? '⇧' : 'Shift');
  }
  const label =
    key === 'up' ? '↑' : key === 'down' ? '↓' : key === 'left' ? '←' : key === 'right' ? '→'
    : key === 'esc' ? 'Esc' : key === 'enter' ? 'Enter' : key === 'space' ? 'Space'
    : key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
  out.push(label);
  return IS_MAC ? out.join('') : out.join('+');
}

/**
 * 事件是不是發生在「正在輸入文字」的地方。
 * 全域快捷鍵大多要在這種情況下讓路（Ctrl+K 例外，那是搜尋）。
 */
export function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
}
