import { memo, type SVGProps } from 'react';
import { ICON_SHAPES, type IconName, type IconShape } from './shapes.js';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** 邊長（px），預設 20。 */
  size?: number | string;
  /** 線條粗細，預設 1.5（Notion 風格）。 */
  strokeWidth?: number;
  /** 沒有文字標籤時務必給，否則預設 aria-hidden。 */
  title?: string;
}

function renderShape(shape: IconShape, key: number, strokeWidth: number): JSX.Element {
  if (typeof shape === 'string') {
    return <path key={key} d={shape} strokeWidth={strokeWidth} />;
  }
  if ('p' in shape) {
    return (
      <path
        key={key}
        d={shape.p}
        {...(shape.fill ? { fill: 'currentColor', stroke: 'none' } : { strokeWidth })}
      />
    );
  }
  if ('circle' in shape) {
    const [cx, cy, r] = shape.circle;
    return (
      <circle
        key={key}
        cx={cx}
        cy={cy}
        r={r}
        {...(shape.fill ? { fill: 'currentColor', stroke: 'none' } : { strokeWidth })}
      />
    );
  }
  const [x, y, w, h, rx] = shape.rect;
  return (
    <rect
      key={key}
      x={x}
      y={y}
      width={w}
      height={h}
      rx={rx ?? 0}
      {...(shape.fill ? { fill: 'currentColor', stroke: 'none' } : { strokeWidth })}
    />
  );
}

/**
 * 自建 icon。20x20 viewBox、1.5px 線條、currentColor。
 * 沒有 title 時自動 aria-hidden，避免螢幕閱讀器念出一堆裝飾性圖示。
 */
export const Icon = memo(function Icon({
  name,
  size = 20,
  strokeWidth = 1.5,
  title,
  ...rest
}: IconProps): JSX.Element {
  const shapes = ICON_SHAPES[name] as readonly IconShape[];
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      data-icon={name}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {shapes.map((shape, i) => renderShape(shape, i, strokeWidth))}
    </svg>
  );
});
