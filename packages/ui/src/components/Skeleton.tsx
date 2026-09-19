import type { CSSProperties, HTMLAttributes } from 'react';
import styles from './Display.module.css';
import { cx } from './cx.js';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** 'text' 高度跟著字級；'rect' 自訂；'circle' 圓形。 */
  shape?: 'text' | 'rect' | 'circle';
  width?: number | string;
  height?: number | string;
  /** text 形狀時要畫幾行。 */
  lines?: number;
}

/** 載入骨架。純 CSS 動畫，reduced-motion 下不閃爍。 */
export function Skeleton({
  shape = 'text',
  width,
  height,
  lines = 1,
  className,
  style,
  ...rest
}: SkeletonProps): JSX.Element {
  const base: CSSProperties = { width, height, ...style };
  const cls = cx(
    styles['skeleton'],
    shape === 'text' && styles['skeletonText'],
    shape === 'circle' && styles['skeletonCircle'],
    className,
  );

  if (shape === 'text' && lines > 1) {
    return (
      <div aria-hidden style={{ display: 'grid', gap: 6 }} {...rest}>
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={cls}
            style={{ ...base, width: i === lines - 1 ? '60%' : base.width ?? '100%' }}
          />
        ))}
      </div>
    );
  }

  return <div aria-hidden className={cls} style={base} {...rest} />;
}
