import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useDndController, useDragState } from './DndProvider.js';
import type { DropResult } from './controller.js';

export interface UseDraggableOptions<P = unknown> {
  id: string;
  /** 用來隔離落點：'block' | 'tree-node' | 'board-card' | 'db-column' | 'view-tab' … */
  kind: string;
  /** 拖曳攜帶的資料。 */
  data?: P;
  disabled?: boolean;
  /** 自製幽靈元素；沒給就複製來源節點。 */
  getGhost?: (source: HTMLElement) => HTMLElement;
  onDragStart?: () => void;
  onDragEnd?: (result: DropResult | null) => void;
}

export interface UseDraggableResult {
  /** 掛到「被拖動的整塊元素」上。 */
  setNodeRef: (node: HTMLElement | null) => void;
  /** 掛到 drag handle 上（可與 setNodeRef 同一個元素）。 */
  handleProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    style: { touchAction: 'none'; cursor: string };
    draggable: false;
  };
  isDragging: boolean;
}

/** 讓一個元素可以被拖曳。實際的狀態機在 DragController（§4.6.2）。 */
export function useDraggable<P = unknown>(options: UseDraggableOptions<P>): UseDraggableResult {
  const { id, kind, data, disabled = false, getGhost, onDragStart, onDragEnd } = options;
  const controller = useDndController();
  const nodeRef = useRef<HTMLElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const latest = useRef({ data, getGhost, onDragStart, onDragEnd, disabled });
  latest.current = { data, getGhost, onDragStart, onDragEnd, disabled };

  const register = useCallback(
    (node: HTMLElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      nodeRef.current = node;
      if (!node) return;
      cleanupRef.current = controller.registerSource(node, {
        id,
        kind,
        get disabled() {
          return latest.current.disabled;
        },
        getPayload: () => latest.current.data,
        ...(latest.current.getGhost ? { getGhost: latest.current.getGhost } : {}),
        onDragStart: () => latest.current.onDragStart?.(),
        onDragEnd: (result) => latest.current.onDragEnd?.(result),
      });
    },
    [controller, id, kind],
  );

  useEffect(() => () => cleanupRef.current?.(), []);

  const state = useDragState();
  const isDragging = state.phase === 'dragging' && state.sourceId === id;

  const handleProps = useMemo(
    () => ({
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (disabled) return;
        controller.handlePointerDown(id, e.nativeEvent);
      },
      // touch-action: none 讓觸控裝置把手勢交給我們，而不是捲動頁面。
      style: { touchAction: 'none' as const, cursor: disabled ? 'default' : 'grab' },
      draggable: false as const,
    }),
    [controller, disabled, id],
  );

  return { setNodeRef: register, handleProps, isDragging };
}
