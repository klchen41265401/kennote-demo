import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import styles from './Button.module.css';
import { Spinner } from './Spinner.js';
import { cx } from './cx.js';

export type ButtonVariant = 'ghost' | 'primary' | 'danger' | 'subtle' | 'outline';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 顯示 spinner 並停用。 */
  loading?: boolean;
  /** 文字前的圖示。 */
  startIcon?: ReactNode;
  /** 文字後的圖示（例如 chevron、快捷鍵）。 */
  endIcon?: ReactNode;
  fullWidth?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'ghost',
    size = 'md',
    loading = false,
    startIcon,
    endIcon,
    fullWidth = false,
    type = 'button',
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        styles['button'],
        styles[variant],
        styles[size],
        fullWidth && styles['fullWidth'],
        loading && styles['loading'],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {startIcon}
      {children}
      {endIcon}
      {loading ? (
        <span className={styles['spinnerSlot']}>
          <Spinner size={size === 'sm' ? 14 : 16} />
        </span>
      ) : null}
    </button>
  );
});
