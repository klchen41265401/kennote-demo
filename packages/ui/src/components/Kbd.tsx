import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Display.module.css';
import { cx } from './cx.js';

const MAC_MAP: Record<string, string> = {
  mod: '⌘',
  cmd: '⌘',
  meta: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  enter: '⏎',
  backspace: '⌫',
  delete: '⌦',
  escape: 'esc',
  tab: '⇥',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

const PC_MAP: Record<string, string> = {
  mod: 'Ctrl',
  cmd: 'Win',
  meta: 'Win',
  ctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  enter: '⏎',
  backspace: '⌫',
  delete: 'Del',
  escape: 'Esc',
  tab: 'Tab',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** 'mod+k' 這種寫法會依平台顯示為 ⌘K / Ctrl+K。 */
  keys?: string;
  children?: ReactNode;
}

/** 快捷鍵標示。keys 用 '+' 分隔，mod 會依平台換成 ⌘ 或 Ctrl。 */
export function Kbd({ keys, children, className, ...rest }: KbdProps): JSX.Element {
  if (!keys) {
    return (
      <kbd className={cx(styles['kbd'], className)} {...rest}>
        {children}
      </kbd>
    );
  }
  const map = isMac() ? MAC_MAP : PC_MAP;
  const parts = keys.split('+').map((raw) => {
    const key = raw.trim();
    return map[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key);
  });
  return (
    <span className={cx(styles['kbdGroup'], className)} {...rest}>
      {parts.map((p, i) => (
        <kbd key={i} className={styles['kbd']}>
          {p}
        </kbd>
      ))}
    </span>
  );
}
