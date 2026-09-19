import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Display.module.css';
import { cx } from './cx.js';

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  /** 中間帶文字的分隔線。 */
  label?: ReactNode;
}

export function Divider({
  orientation = 'horizontal',
  label,
  className,
  ...rest
}: DividerProps): JSX.Element {
  if (label) {
    return (
      <div className={cx(styles['dividerLabel'], className)} role="separator" {...rest}>
        {label}
      </div>
    );
  }
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cx(
        styles['divider'],
        orientation === 'vertical' ? styles['dividerVertical'] : styles['dividerHorizontal'],
        className,
      )}
      {...rest}
    />
  );
}
