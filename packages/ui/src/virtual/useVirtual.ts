import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * 自製虛擬捲動核心（02-UI架構 §8.4）。
 * 固定高：純數學。不定高：measure cache + 前綴和 + ResizeObserver 回填。
 */

export interface UseVirtualOptions {
  count: number;
  /** 捲動容器。 */
  getScrollElement: () => HTMLElement | null;
  /** 固定高（數字）或每項高度函式；不給就走「不定高 + 量測快取」模式。 */
  itemSize?: number | ((index: number) => number);
  /** 不定高模式下未量測項目的估計值，預設 60。 */
  estimateSize?: number;
  /** 視窗外多渲染幾筆，預設 4。 */
  overscan?: number;
  /** 橫向（資料庫表格欄）。 */
  horizontal?: boolean;
  /** 容器尺寸取不到時的後備值（SSR / jsdom）。 */
  fallbackViewport?: number;
}

export interface VirtualItem {
  index: number;
  start: number;
  size: number;
  end: number;
}

export interface UseVirtualResult {
  virtualItems: VirtualItem[];
  totalSize: number;
  startIndex: number;
  endIndex: number;
  scrollOffset: number;
  viewportSize: number;
  /** 不定高模式：掛到每個項目元素上，量到真實高度後回填。 */
  measureRef: (index: number) => (node: HTMLElement | null) => void;
  scrollToIndex: (index: number, options?: { align?: ScrollAlign; behavior?: ScrollBehavior }) => void;
  scrollToOffset: (offset: number, options?: { behavior?: ScrollBehavior }) => void;
  /** 強制重新量測（例如資料換了）。 */
  measure: () => void;
}

export type ScrollAlign = 'auto' | 'start' | 'center' | 'end';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function useVirtual(options: UseVirtualOptions): UseVirtualResult {
  const {
    count,
    getScrollElement,
    itemSize,
    estimateSize = 60,
    overscan = 4,
    horizontal = false,
    fallbackViewport = 0,
  } = options;

  const fixedSize = typeof itemSize === 'number' ? itemSize : null;
  const sizeFn = typeof itemSize === 'function' ? itemSize : null;
  const dynamic = fixedSize === null && sizeFn === null;

  const [scrollOffset, setScrollOffset] = useState(0);
  const [viewportSize, setViewportSize] = useState(fallbackViewport);
  // 量測回填後用版本號強制重算 memo（size cache 存在 ref 裡，React 看不見它變了）。
  const [version, setVersion] = useState(0);

  // ── 不定高模式的量測快取與前綴和 ──
  const sizesRef = useRef<number[]>([]);
  const offsetsRef = useRef<number[]>([]);
  const firstDirtyRef = useRef(0);
  const elementsRef = useRef(new Map<number, HTMLElement>());
  const observerRef = useRef<ResizeObserver | null>(null);

  if (sizesRef.current.length !== count) {
    const next = sizesRef.current.slice(0, count);
    for (let i = next.length; i < count; i++) next.push(estimateSize);
    sizesRef.current = next;
    firstDirtyRef.current = 0;
  }

  /** 分段重算前綴和：只算 firstDirty 之後的部分。 */
  const ensureOffsets = useCallback((): number[] => {
    const sizes = sizesRef.current;
    const offsets = offsetsRef.current;
    let i = firstDirtyRef.current;
    if (offsets.length !== count + 1) {
      offsets.length = count + 1;
      if (i > count) i = 0;
    }
    if (i === 0) offsets[0] = 0;
    for (; i < count; i++) {
      offsets[i + 1] = (offsets[i] ?? 0) + (sizes[i] ?? estimateSize);
    }
    firstDirtyRef.current = count;
    return offsets;
  }, [count, estimateSize]);

  const getStart = useCallback(
    (index: number): number => {
      if (fixedSize !== null) return index * fixedSize;
      if (sizeFn) {
        let acc = 0;
        for (let i = 0; i < index; i++) acc += sizeFn(i);
        return acc;
      }
      return ensureOffsets()[index] ?? 0;
    },
    [fixedSize, sizeFn, ensureOffsets, version],
  );

  const getSize = useCallback(
    (index: number): number => {
      if (fixedSize !== null) return fixedSize;
      if (sizeFn) return sizeFn(index);
      return sizesRef.current[index] ?? estimateSize;
    },
    [fixedSize, sizeFn, estimateSize, version],
  );

  const totalSize = useMemo(() => {
    if (fixedSize !== null) return count * fixedSize;
    if (sizeFn) {
      let acc = 0;
      for (let i = 0; i < count; i++) acc += sizeFn(i);
      return acc;
    }
    return ensureOffsets()[count] ?? 0;
    // version 進 deps 是為了在量測回填後重算總高。
  }, [count, fixedSize, sizeFn, ensureOffsets, version]);

  // ── 可視範圍 ──
  const { startIndex, endIndex } = useMemo(() => {
    if (count === 0) return { startIndex: 0, endIndex: -1 };
    const view = viewportSize || fallbackViewport;
    if (fixedSize !== null) {
      const s = clamp(Math.floor(scrollOffset / fixedSize) - overscan, 0, count - 1);
      const e = clamp(Math.ceil((scrollOffset + view) / fixedSize) + overscan, 0, count - 1);
      return { startIndex: s, endIndex: e };
    }
    // 不定高 / 自訂高：二分搜尋前綴和。
    const offsets = dynamic ? ensureOffsets() : null;
    const startAt = (target: number): number => {
      if (offsets) {
        let lo = 0;
        let hi = count - 1;
        let ans = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if ((offsets[mid] ?? 0) <= target) {
            ans = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        return ans;
      }
      let acc = 0;
      for (let i = 0; i < count; i++) {
        const next = acc + getSize(i);
        if (next > target) return i;
        acc = next;
      }
      return count - 1;
    };
    const s = clamp(startAt(scrollOffset) - overscan, 0, count - 1);
    let e = s;
    let acc = getStart(s);
    while (e < count - 1 && acc < scrollOffset + view) {
      acc += getSize(e);
      e += 1;
    }
    e = clamp(e + overscan, 0, count - 1);
    return { startIndex: s, endIndex: e };
  }, [
    count,
    viewportSize,
    fallbackViewport,
    scrollOffset,
    overscan,
    fixedSize,
    dynamic,
    ensureOffsets,
    getSize,
    getStart,
  ]);

  const virtualItems = useMemo(() => {
    const out: VirtualItem[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      const start = getStart(i);
      const size = getSize(i);
      out.push({ index: i, start, size, end: start + size });
    }
    return out;
  }, [startIndex, endIndex, getStart, getSize]);

  // ── 捲動與尺寸監聽 ──
  useEffect(() => {
    const el = getScrollElement();
    if (!el) return;
    const read = (): void => {
      setScrollOffset(horizontal ? el.scrollLeft : el.scrollTop);
      const size = horizontal ? el.clientWidth : el.clientHeight;
      if (size > 0) setViewportSize(size);
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(read);
      ro.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', read);
      ro?.disconnect();
    };
  }, [getScrollElement, horizontal]);

  // ── 不定高：ResizeObserver 回填真實高度 ──
  const applyMeasurement = useCallback(
    (index: number, size: number) => {
      if (!dynamic || size <= 0) return;
      const prev = sizesRef.current[index] ?? estimateSize;
      if (Math.abs(prev - size) < 0.5) return;
      const delta = size - prev;
      sizesRef.current[index] = size;
      firstDirtyRef.current = Math.min(firstDirtyRef.current, index);
      // 修正點在視窗之上時必須同步調整 scrollTop，否則畫面會跳動（§8.4）。
      const el = getScrollElement();
      if (el && index < startIndex) {
        if (horizontal) el.scrollLeft += delta;
        else el.scrollTop += delta;
      }
      setVersion((n) => n + 1);
    },
    [dynamic, estimateSize, getScrollElement, startIndex, horizontal],
  );

  const measureRef = useCallback(
    (index: number) =>
      (node: HTMLElement | null): void => {
        if (!dynamic) return;
        const map = elementsRef.current;
        const prev = map.get(index);
        if (prev && observerRef.current) observerRef.current.unobserve(prev);
        if (!node) {
          map.delete(index);
          return;
        }
        map.set(index, node);
        node.dataset['index'] = String(index);
        const rect = node.getBoundingClientRect();
        applyMeasurement(index, horizontal ? rect.width : rect.height);
        if (!observerRef.current && typeof ResizeObserver !== 'undefined') {
          observerRef.current = new ResizeObserver((entries) => {
            for (const entry of entries) {
              const target = entry.target as HTMLElement;
              const idx = Number(target.dataset['index']);
              if (Number.isNaN(idx)) continue;
              const box = target.getBoundingClientRect();
              applyMeasurement(idx, horizontal ? box.width : box.height);
            }
          });
        }
        observerRef.current?.observe(node);
      },
    [dynamic, horizontal, applyMeasurement],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  // ── 捲動 API ──
  const scrollToOffset = useCallback(
    (offset: number, opts?: { behavior?: ScrollBehavior }) => {
      const el = getScrollElement();
      if (!el) return;
      const behavior = opts?.behavior ?? 'auto';
      // jsdom / 舊瀏覽器沒有實作 scrollTo，退回直接設 scrollTop/scrollLeft。
      if (typeof el.scrollTo === 'function') {
        if (horizontal) el.scrollTo({ left: offset, behavior });
        else el.scrollTo({ top: offset, behavior });
      }
      if (horizontal) el.scrollLeft = offset;
      else el.scrollTop = offset;
      setScrollOffset(offset);
    },
    [getScrollElement, horizontal],
  );

  const scrollToIndex = useCallback(
    (index: number, opts?: { align?: ScrollAlign; behavior?: ScrollBehavior }) => {
      const i = clamp(index, 0, Math.max(0, count - 1));
      const align = opts?.align ?? 'auto';
      const start = getStart(i);
      const size = getSize(i);
      const view = viewportSize || fallbackViewport;
      let target = start;
      if (align === 'center') target = start - view / 2 + size / 2;
      else if (align === 'end') target = start - view + size;
      else if (align === 'auto') {
        if (start < scrollOffset) target = start;
        else if (start + size > scrollOffset + view) target = start - view + size;
        else return;
      }
      const max = Math.max(0, totalSize - view);
      const next: { behavior?: ScrollBehavior } = {};
      if (opts?.behavior) next.behavior = opts.behavior;
      scrollToOffset(clamp(Math.round(target), 0, max), next);
    },
    [count, getStart, getSize, viewportSize, fallbackViewport, scrollOffset, totalSize, scrollToOffset],
  );

  const measure = useCallback(() => {
    firstDirtyRef.current = 0;
    setVersion((n) => n + 1);
  }, []);

  return {
    virtualItems,
    totalSize,
    startIndex,
    endIndex,
    scrollOffset,
    viewportSize: viewportSize || fallbackViewport,
    measureRef,
    scrollToIndex,
    scrollToOffset,
    measure,
  };
}
