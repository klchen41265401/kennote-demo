/**
 * 全域快捷鍵表（01-功能架構 §11.1）。**唯一定義處**。
 *
 * - 表本身是純資料 → `Ctrl+/` 的快捷鍵說明 Dialog 直接吃它。
 * - 註冊只在 `useGlobalShortcuts()` 做一次（document capture 階段），
 *   避免每個元件自己綁 keydown（02 §4.7 的浮層紀律同理）。
 * - 編輯器內部的快捷鍵在 `features/editor/keyboard/hostKeymap.ts`，兩邊不重疊。
 */
import { useEffect, useRef } from 'react';
import { eventToCombo, isEditingTarget, normalizeCombo } from './keyboard';

export type ShortcutAction =
  | 'newPage'
  | 'newWindow'
  | 'search'
  | 'quickSwitch'
  | 'toggleSidebar'
  | 'toggleTheme'
  | 'shortcutHelp'
  | 'goBack'
  | 'goForward'
  | 'newAiChat'
  | 'settings';

export interface ShortcutDef {
  action: ShortcutAction;
  combo: string;
  label: string;
  group: string;
  /** 在輸入框 / contenteditable 裡仍然生效 */
  allowInInput?: boolean;
  /** 尚未實作（說明表裡會標示） */
  todo?: boolean;
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { action: 'newPage', combo: 'mod+n', label: '建立新頁面', group: '一般' },
  { action: 'newWindow', combo: 'mod+shift+n', label: '開新視窗', group: '一般', todo: true },
  { action: 'search', combo: 'mod+k', label: '搜尋', group: '一般', allowInInput: true },
  { action: 'quickSwitch', combo: 'mod+p', label: '快速切換頁面', group: '一般', allowInInput: true },
  { action: 'newAiChat', combo: 'mod+o', label: '新對話（AI）', group: '一般' },
  { action: 'toggleSidebar', combo: 'mod+\\', label: '開關側邊欄', group: '版面', allowInInput: true },
  { action: 'toggleTheme', combo: 'mod+shift+l', label: '切換深色 / 淺色', group: '版面', allowInInput: true },
  { action: 'shortcutHelp', combo: 'mod+/', label: '快捷鍵說明', group: '版面' },
  { action: 'settings', combo: 'mod+,', label: '設定', group: '版面' },
  { action: 'goBack', combo: 'mod+[', label: '上一頁', group: '導覽', allowInInput: true },
  { action: 'goForward', combo: 'mod+]', label: '下一頁', group: '導覽', allowInInput: true },
];

/** 給說明 Dialog 用：依 group 分組（保持表上的順序） */
export function shortcutGroups(): { group: string; items: ShortcutDef[] }[] {
  const out: { group: string; items: ShortcutDef[] }[] = [];
  for (const s of SHORTCUTS) {
    let bucket = out.find((g) => g.group === s.group);
    if (!bucket) out.push((bucket = { group: s.group, items: [] }));
    bucket.items.push(s);
  }
  return out;
}

/** 純函式：一個鍵盤事件對應到哪個動作（沒有就是 null）—— 有單元測試 */
export function resolveShortcut(
  e: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean },
  options: { inInput?: boolean } = {},
): ShortcutAction | null {
  const combo = eventToCombo(e);
  for (const s of SHORTCUTS) {
    if (normalizeCombo(s.combo) !== combo) continue;
    if (options.inInput && !s.allowInInput) return null;
    return s.action;
  }
  return null;
}

export type ShortcutHandlers = Partial<Record<ShortcutAction, () => void>>;

/** 註冊全域快捷鍵。handlers 可以每次 render 換新物件（用 ref 讀取） */
export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.isComposing) return;
      const action = resolveShortcut(e, { inInput: isEditingTarget(e.target) });
      if (!action) return;
      const fn = ref.current[action];
      if (!fn) return;
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
