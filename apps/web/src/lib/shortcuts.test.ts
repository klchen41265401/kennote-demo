import { describe, expect, it } from 'vitest';
import { eventToCombo, formatCombo, isEditingTarget, normalizeCombo, normalizeKey } from './keyboard';
import { resolveShortcut, SHORTCUTS, shortcutGroups } from './shortcuts';

// 測試環境（jsdom on win32）一律走非 mac 分支：mod = Ctrl
const ctrl = (key: string, extra: Record<string, boolean> = {}) => ({
  key,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
});

describe('normalizeKey', () => {
  it('單一字元轉小寫', () => {
    expect(normalizeKey('K')).toBe('k');
    expect(normalizeKey('\\')).toBe('\\');
  });
  it('特殊鍵有固定名稱', () => {
    expect(normalizeKey('ArrowUp')).toBe('up');
    expect(normalizeKey('Escape')).toBe('esc');
    expect(normalizeKey('Enter')).toBe('enter');
    expect(normalizeKey(' ')).toBe('space');
  });
});

describe('normalizeCombo', () => {
  it('ctrl / cmd / mod 都正規化成 mod', () => {
    expect(normalizeCombo('Ctrl+K')).toBe('mod+k');
    expect(normalizeCombo('cmd+k')).toBe('mod+k');
    expect(normalizeCombo('mod+K')).toBe('mod+k');
  });
  it('修飾鍵順序固定為 mod > alt > shift', () => {
    expect(normalizeCombo('shift+mod+l')).toBe('mod+shift+l');
    expect(normalizeCombo('mod+shift+l')).toBe('mod+shift+l');
  });
  it('escape 與 esc 等價', () => {
    expect(normalizeCombo('escape')).toBe('esc');
  });
});

describe('eventToCombo', () => {
  it('Ctrl+K', () => {
    expect(eventToCombo(ctrl('k'))).toBe('mod+k');
  });
  it('Ctrl+Shift+L', () => {
    expect(eventToCombo(ctrl('L', { shiftKey: true }))).toBe('mod+shift+l');
  });
  it('沒有修飾鍵時就是鍵名', () => {
    expect(eventToCombo({ key: 'Escape' })).toBe('esc');
  });
  it('與 normalizeCombo 的結果可以直接比對', () => {
    expect(eventToCombo(ctrl('\\'))).toBe(normalizeCombo('mod+\\'));
  });
});

describe('resolveShortcut', () => {
  it('對應到表上的動作', () => {
    expect(resolveShortcut(ctrl('k'))).toBe('search');
    expect(resolveShortcut(ctrl('p'))).toBe('quickSwitch');
    expect(resolveShortcut(ctrl('n'))).toBe('newPage');
    expect(resolveShortcut(ctrl('\\'))).toBe('toggleSidebar');
    expect(resolveShortcut(ctrl('l', { shiftKey: true }))).toBe('toggleTheme');
    expect(resolveShortcut(ctrl('['))).toBe('goBack');
    expect(resolveShortcut(ctrl(']'))).toBe('goForward');
  });

  it('表上沒有的組合回 null', () => {
    expect(resolveShortcut(ctrl('q'))).toBeNull();
    expect(resolveShortcut({ key: 'k' })).toBeNull();
  });

  it('在輸入框裡只放行 allowInInput 的項目', () => {
    expect(resolveShortcut(ctrl('k'), { inInput: true })).toBe('search');
    expect(resolveShortcut(ctrl('\\'), { inInput: true })).toBe('toggleSidebar');
    // Ctrl+N 會跟輸入衝突，在輸入框裡不生效
    expect(resolveShortcut(ctrl('n'), { inInput: true })).toBeNull();
  });
});

describe('快捷鍵表本身', () => {
  it('沒有重複的組合', () => {
    const combos = SHORTCUTS.map((s) => normalizeCombo(s.combo));
    expect(new Set(combos).size).toBe(combos.length);
  });
  it('沒有重複的 action', () => {
    const actions = SHORTCUTS.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
  it('分組保留表上的順序且涵蓋全部項目', () => {
    const groups = shortcutGroups();
    expect(groups.map((g) => g.group)).toEqual(['一般', '版面', '導覽']);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(SHORTCUTS.length);
  });
});

describe('formatCombo', () => {
  it('非 mac 顯示 Ctrl+K', () => {
    expect(formatCombo('mod+k')).toBe('Ctrl+K');
    expect(formatCombo('mod+shift+l')).toBe('Ctrl+Shift+L');
  });
  it('方向鍵用箭頭符號', () => {
    expect(formatCombo('mod+up')).toBe('Ctrl+↑');
  });
});

describe('isEditingTarget', () => {
  it('input / textarea 算編輯中', () => {
    expect(isEditingTarget(document.createElement('input'))).toBe(true);
    expect(isEditingTarget(document.createElement('textarea'))).toBe(true);
  });
  it('一般元素不算', () => {
    expect(isEditingTarget(document.createElement('div'))).toBe(false);
    expect(isEditingTarget(null)).toBe(false);
  });
});
