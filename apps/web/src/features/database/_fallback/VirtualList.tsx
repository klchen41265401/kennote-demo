import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface VirtualListProps<T> {
  items: T[];
  /** 固定列高（Notion 表格列高 32px） */
  itemHeight: number;
  /** 視窗高度；不給就用容器實際高度 */
  height?: number;
  /** 上下各多算幾列，避免快速捲動時出現空白 */
  overscan?: number;
  renderItem: (item: T, index: number) => ReactNode;
  /** 捲到底部前這麼多 px 觸發載入下一頁（02 §3.5：200px） */
  onEndReached?: () => void;
  endReachedThreshold?: number;
  className?: string;
  /** 列表底部（「＋ 新增」「聚合列」）—— 跟著內容捲動 */
  footer?: ReactNode;
  ariaLabel?: string;
}

/**
 * 自研固定高虛擬捲動（04 §8 M4 交付物 5）。
 *
 * 只渲染可視範圍 ± overscan 的列，上下各用一個空 div 撐出總高度。
 * 1000 筆資料時 DOM 節點數會穩定在 < 100（M4 驗收標準）。
 */
export function VirtualList<T>({
  items,
  itemHeight,
  height,
  overscan = 6,
  renderItem,
  onEndReached,
  endReachedThreshold = 200,
  className,
  footer,
  ariaLabel,
}: VirtualListProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(height ?? 600);
  const endReachedRef = useRef(false);

  useEffect(() => {
    if (height !== undefined) {
      setViewport(height);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const update = () => setViewport(el.clientHeight || 600);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [height]);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      setScrollTop(el.scrollTop);
      if (!onEndReached) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distance < endReachedThreshold) {
        if (!endReachedRef.current) {
          endReachedRef.current = true;
          onEndReached();
        }
      } else {
        endReachedRef.current = false;
      }
    },
    [onEndReached, endReachedThreshold],
  );

  const total = items.length;
  const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const visibleCount = Math.ceil(viewport / itemHeight) + overscan * 2;
  const end = Math.min(total, start + visibleCount);
  const padTop = start * itemHeight;
  const padBottom = Math.max(0, (total - end) * itemHeight);

  return (
    <div
      ref={ref}
      className={className}
      onScroll={onScroll}
      style={height !== undefined ? { height, overflowY: 'auto' } : { overflowY: 'auto' }}
      role="rowgroup"
      aria-label={ariaLabel}
      aria-rowcount={total}
    >
      {padTop > 0 ? <div style={{ height: padTop }} aria-hidden="true" /> : null}
      {items.slice(start, end).map((item, i) => renderItem(item, start + i))}
      {padBottom > 0 ? <div style={{ height: padBottom }} aria-hidden="true" /> : null}
      {footer}
    </div>
  );
}
