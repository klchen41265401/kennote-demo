import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import { useVirtual, type ScrollAlign, type VirtualItem } from './useVirtual.js';

export interface VirtualListHandle {
  scrollToIndex: (index: number, options?: { align?: ScrollAlign; behavior?: ScrollBehavior }) => void;
  scrollToOffset: (offset: number, options?: { behavior?: ScrollBehavior }) => void;
  measure: () => void;
  getScrollElement: () => HTMLElement | null;
}

export interface VirtualListProps<T> {
  items: readonly T[];
  /** 固定高（數字，效能最好）或每項高度函式；不給就走不定高 + 量測快取模式。 */
  itemSize?: number | ((index: number) => number);
  /** 不定高模式的估計值，預設 60。 */
  estimateSize?: number;
  /** 視窗外多渲染幾筆，預設 4。 */
  overscan?: number;
  /** 橫向虛擬化（資料庫表格欄）。 */
  horizontal?: boolean;
  /** 容器高度（橫向時為寬度）。數字會同時作為 jsdom / SSR 的後備視窗尺寸。 */
  size?: number | string;
  getKey?: (item: T, index: number) => string | number;
  className?: string;
  style?: CSSProperties;
  /** 沒有資料時顯示。 */
  empty?: ReactNode;
  children: (item: T, virtual: VirtualItem) => ReactNode;
}

/**
 * 自製虛擬捲動（§8.4）。不使用任何虛擬捲動套件。
 * 固定高走純數學；不定高走 measure cache + ResizeObserver 回填並修正 scrollTop。
 */
function VirtualListInner<T>(
  props: VirtualListProps<T>,
  ref: Ref<VirtualListHandle>,
): JSX.Element {
  const {
    items,
    itemSize,
    estimateSize = 60,
    overscan = 4,
    horizontal = false,
    size = 400,
    getKey,
    className,
    style,
    empty,
    children,
  } = props;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const getScrollElement = useCallback(() => scrollRef.current, []);

  const virtual = useVirtual({
    count: items.length,
    getScrollElement,
    ...(itemSize !== undefined ? { itemSize } : {}),
    estimateSize,
    overscan,
    horizontal,
    fallbackViewport: typeof size === 'number' ? size : 0,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToIndex: virtual.scrollToIndex,
      scrollToOffset: virtual.scrollToOffset,
      measure: virtual.measure,
      getScrollElement,
    }),
    [virtual.scrollToIndex, virtual.scrollToOffset, virtual.measure, getScrollElement],
  );

  const viewportStyle: CSSProperties = {
    overflow: 'auto',
    position: 'relative',
    ...(horizontal ? { width: size, overflowY: 'hidden' } : { height: size, overflowX: 'hidden' }),
    ...style,
  };

  const innerStyle: CSSProperties = horizontal
    ? { width: virtual.totalSize, height: '100%', position: 'relative' }
    : { height: virtual.totalSize, width: '100%', position: 'relative' };

  return (
    <div
      ref={scrollRef}
      className={className}
      style={viewportStyle}
      data-kn-virtual={horizontal ? 'horizontal' : 'vertical'}
    >
      {items.length === 0 && empty ? (
        empty
      ) : (
        <div style={innerStyle}>
          {virtual.virtualItems.map((v) => {
            const item = items[v.index] as T;
            const itemStyle: CSSProperties = horizontal
              ? {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  height: '100%',
                  transform: `translate3d(${Math.round(v.start)}px, 0, 0)`,
                  ...(itemSize !== undefined ? { width: v.size } : {}),
                }
              : {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translate3d(0, ${Math.round(v.start)}px, 0)`,
                  ...(itemSize !== undefined ? { height: v.size } : {}),
                };
            return (
              <div
                key={getKey ? getKey(item, v.index) : v.index}
                ref={itemSize === undefined ? virtual.measureRef(v.index) : undefined}
                data-index={v.index}
                style={itemStyle}
              >
                {children(item, v)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: Ref<VirtualListHandle> },
) => JSX.Element;
