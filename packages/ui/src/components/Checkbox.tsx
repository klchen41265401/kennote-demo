import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import styles from './Form.module.css';
import { cx } from './cx.js';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** 半選狀態（用於「全選」父項）。 */
  indeterminate?: boolean;
  children?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { indeterminate = false, children, className, disabled, ...rest },
  ref,
) {
  const localRef = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(ref, () => localRef.current as HTMLInputElement);

  useEffect(() => {
    if (localRef.current) localRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={cx(styles['checkbox'], disabled && styles['checkboxDisabled'], className)}
    >
      <input
        ref={localRef}
        type="checkbox"
        className={styles['checkboxInput']}
        disabled={disabled}
        {...rest}
      />
      <span className={styles['checkboxBox']} aria-hidden>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}>
          {indeterminate ? (
            <path d="M3 6h6" strokeLinecap="round" />
          ) : (
            <path d="M2.5 6.2l2.4 2.4L9.5 3.8" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
      </span>
      {children}
    </label>
  );
});
