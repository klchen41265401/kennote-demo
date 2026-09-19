import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import styles from './Form.module.css';
import { cx } from './cx.js';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  size?: 'sm' | 'md';
  variant?: 'outline' | 'filled';
  label?: ReactNode;
  hint?: ReactNode;
  /** 有值時顯示紅框並以 aria-invalid 標記。 */
  error?: ReactNode;
  /** 輸入框內左側的圖示或文字。 */
  startAdornment?: ReactNode;
  /** 輸入框內右側的圖示或文字。 */
  endAdornment?: ReactNode;
  /** 掛載後自動聚焦並把游標移到最後（重新命名頁面時常用）。 */
  autoSelect?: boolean;
}

/** 受控／非受控皆可，支援前後綴與錯誤狀態。 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    size = 'md',
    variant = 'outline',
    label,
    hint,
    error,
    startAdornment,
    endAdornment,
    autoSelect,
    className,
    disabled,
    id,
    ...rest
  },
  ref,
) {
  const localRef = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(ref, () => localRef.current as HTMLInputElement);
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  useEffect(() => {
    if (!autoSelect) return;
    const el = localRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, [autoSelect]);

  const field = (
    <div
      className={cx(
        styles['field'],
        size === 'sm' ? styles['fieldSm'] : styles['fieldMd'],
        variant === 'filled' && styles['fieldFilled'],
        error && styles['fieldInvalid'],
        disabled && styles['fieldDisabled'],
        !label && !hint && !error ? className : undefined,
      )}
    >
      {startAdornment ? <span className={styles['affix']}>{startAdornment}</span> : null}
      <input
        ref={localRef}
        id={inputId}
        className={styles['input']}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {endAdornment ? <span className={styles['affix']}>{endAdornment}</span> : null}
    </div>
  );

  if (!label && !hint && !error) return field;

  return (
    <div className={cx(styles['inputWrapper'], className)}>
      {label ? (
        <label className={styles['label']} htmlFor={inputId}>
          {label}
        </label>
      ) : null}
      {field}
      {error ? (
        <span id={`${inputId}-error`} className={styles['error']}>
          {error}
        </span>
      ) : hint ? (
        <span id={`${inputId}-hint`} className={styles['hint']}>
          {hint}
        </span>
      ) : null}
    </div>
  );
});
