import { useCallback, useEffect, useRef } from 'react';
import { useDndController, useDragState } from './DndProvider.js';
import type { DropResult } from './controller.js';
import type { ComputeDropTargetOptions, DropItemRect, DropTarget, Point } from './computeDropTarget.js';

export interface UseDroppableOptions {
  id: string;
  /** 接受哪些 kind 的來源。 */
  accepts: readonly string[];
  orientation?: 'vertical' | 'horizontal';
  /** 項目選擇器，預設 '[data-kn-dnd-item]'（元素需有 data-id / 可選 data-depth）。 */
  itemSelector?: string;
  dropOptions?: ComputeDropTargetOptions;
  resolveDrop?: (pointer: Point, items: readonly DropItemRect[]) => DropTarget | null;
  getScrollContainer?: () => HTMLElement | null;
  onDrop?: (result: DropResult) => void;
}

export interface UseDroppableResult {
  setNodeRef: (node: HTMLElement | null) => void;
  /** 指標目前是否在這個 zone 上。 */
  isOver: boolean;
  /** 目前的落點（給呼叫端自行畫特殊指示器時用；一般交給 DndProvider 的共用 indicator）。 */
  target: DropTarget | null;
}

/** 把一個容器登記成落點區域。 */
export function useDroppable(options: UseDroppableOptions): UseDroppableResult {
  const { id, accepts, orientation = 'vertical', itemSelector, dropOptions, resolveDrop, getScrollContainer, onDrop } =
    options;
  const controller = useDndController();
  const cleanupRef = useRef<(() => void) | null>(null);
  const latest = useRef({ dropOptions, resolveDrop, getScrollContainer, onDrop });
  latest.current = { dropOptions, resolveDrop, getScrollContainer, onDrop };

  const acceptsKey = accepts.join(',');
  const hasResolver = Boolean(resolveDrop);

  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (!node) return;
      cleanupRef.current = controller.registerZone(node, {
        id,
        accepts: acceptsKey.split(',').filter(Boolean),
        orientation,
        ...(itemSelector ? { itemSelector } : {}),
        get dropOptions() {
          return latest.current.dropOptions;
        },
        // 沒有自訂解析器時就不要塞欄位，controller 才會走預設的 computeDropTarget。
        ...(hasResolver
          ? {
              resolveDrop: (pointer: Point, items: readonly DropItemRect[]) =>
                latest.current.resolveDrop?.(pointer, items) ?? null,
            }
          : {}),
        getScrollContainer: () => latest.current.getScrollContainer?.() ?? null,
        onDrop: (result) => latest.current.onDrop?.(result),
      });
    },
    [controller, id, acceptsKey, orientation, itemSelector, hasResolver],
  );

  useEffect(() => () => cleanupRef.current?.(), []);

  const state = useDragState();
  const isOver = state.phase === 'dragging' && state.zoneId === id;
  return { setNodeRef, isOver, target: isOver ? state.target : null };
}
