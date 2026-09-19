import type { SVGProps } from 'react';
import styles from './Display.module.css';
import { cx } from './cx.js';

export interface SpinnerProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  size?: number;
  /** 沒有可見文字時給它，會以 aria-label 呈現。 */
  label?: string;
}

/** 純 CSS 動畫，遵循 prefers-reduced-motion（§4.7.4）。 */
export function Spinner({ size = 16, label, className, ...rest }: SpinnerProps): JSX.Element {
  return (
    <svg
      className={cx(styles['spinner'], className)}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...rest}
    >
      <circle className={styles['spinnerTrack']} cx="10" cy="10" r="8" />
      <path d="M18 10a8 8 0 0 0-8-8" strokeLinecap="round" />
    </svg>
  );
}
