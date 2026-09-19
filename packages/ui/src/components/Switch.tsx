import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import styles from './Form.module.css';
import { cx } from './cx.js';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  size?: 'sm' | 'md';
  children?: ReactNode;
}

/**
 * 原生 input[type=checkbox] + 自繪外觀（appearance: none 的概念），
 * 保留鍵盤與表單語意（§4.7.4）。
 */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { size = 'md', children, className, disabled, ...rest },
  ref,
) {
  return (
    <label
      className={cx(
        styles['switch'],
        size === 'sm' && styles['switchSm'],
        disabled && styles['switchDisabled'],
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        className={styles['switchInput']}
        disabled={disabled}
        {...rest}
      />
      <span className={styles['switchTrack']} aria-hidden>
        <span className={styles['switchThumb']} />
      </span>
      {children}
    </label>
  );
});
