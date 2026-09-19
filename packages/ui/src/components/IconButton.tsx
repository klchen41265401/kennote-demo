import { forwardRef } from 'react';
import { Tooltip } from './Tooltip.js';
import { Button, type ButtonProps } from './Button.js';
import styles from './Button.module.css';
import { cx } from './cx.js';

export interface IconButtonProps extends Omit<ButtonProps, 'startIcon' | 'endIcon' | 'fullWidth'> {
  /** 必填：icon-only 按鈕一定要有無障礙名稱。同時當作 tooltip 內容。 */
  label: string;
  /** 顯示 tooltip，預設 true（§4.7.4：IconButton 必帶 Tooltip）。 */
  tooltip?: boolean;
  /** tooltip 右側的快捷鍵，例如 'mod+b'。 */
  shortcut?: string;
}

/** 只有圖示的按鈕。最小點擊區 32x32（觸控 44x44，見 Button.module.css）。 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tooltip = true, shortcut, size = 'md', className, children, ...rest },
  ref,
) {
  const button = (
    <Button
      ref={ref}
      size={size}
      aria-label={label}
      className={cx(styles['iconOnly'], styles['iconButton'], className)}
      {...rest}
    >
      {children}
    </Button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} {...(shortcut ? { shortcut } : {})}>
      {button}
    </Tooltip>
  );
});
