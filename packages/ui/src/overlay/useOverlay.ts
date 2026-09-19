import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { overlayStack, overlayZIndex, type OverlayEntry, type OverlayLevel } from './stack.js';

export interface UseOverlayOptions {
  /** 浮層是否開啟。 */
  open: boolean;
  /** 決定 z-index 與語意層級，預設 'dropdown'。 */
  level?: OverlayLevel;
  /** 要求關閉時呼叫（Esc / 點外部 / 堆疊連帶關閉）。 */
  onClose?: () => void;
  /** 點外部關閉，預設 true。 */
  closeOnOutside?: boolean;
  /** Esc 關閉（只關最上層），預設 true。 */
  closeOnEsc?: boolean;
  /** 開啟時捕捉 Tab、關閉時還原焦點，預設 false（Dialog 才需要）。 */
  trapFocus?: boolean;
  /** 鎖 body 捲動，預設 false（Modal 才需要）。 */
  lockScroll?: boolean;
  /** 觸發錨點：點在它上面不視為「外部」。 */
  anchor?: Element | null | (() => Element | null | undefined);
}

export interface UseOverlayResult {
  /** 這一層在堆疊中的 id（也會寫到根元素的 id 屬性上）。 */
  id: string | null;
  /** 應套用的 z-index。 */
  zIndex: number;
  /** 掛到浮層根元素上的 ref callback。 */
  setFloating: (node: HTMLElement | null) => void;
  /** 是否為堆疊最上層。 */
  isTop: boolean;
  /** 主動關閉（會連帶關掉其上的所有層）。 */
  close: () => void;
}

/**
 * 把一個浮層登記進 overlayStack，並拿回 z-index 與根元素 ref。
 * Esc / 外部點擊的實際判定在 stack.ts，元件本身不綁 document 事件（§4.7.2）。
 */
export function useOverlay(options: UseOverlayOptions): UseOverlayResult {
  const {
    open,
    level = 'dropdown',
    onClose,
    closeOnOutside = true,
    closeOnEsc = true,
    trapFocus = false,
    lockScroll = false,
    anchor,
  } = options;

  const [id, setId] = useState<string | null>(null);
  const floatingRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const anchorRef = useRef(anchor);
  onCloseRef.current = onClose;
  anchorRef.current = anchor;

  useEffect(() => {
    if (!open) {
      setId(null);
      return;
    }
    const entryId = overlayStack.open({
      level,
      closeOnOutside,
      closeOnEsc,
      trapFocus,
      lockScroll,
      getAnchor: () => {
        const a = anchorRef.current;
        return typeof a === 'function' ? a() : a;
      },
      onClose: () => onCloseRef.current?.(),
    });
    overlayStack.setElement(entryId, floatingRef.current);
    setId(entryId);
    return () => {
      overlayStack.remove(entryId);
    };
  }, [open, level, closeOnOutside, closeOnEsc, trapFocus, lockScroll]);

  const setFloating = useCallback(
    (node: HTMLElement | null) => {
      floatingRef.current = node;
      if (id) overlayStack.setElement(id, node);
    },
    [id],
  );

  const entries = useSyncExternalStore(
    overlayStack.subscribe,
    overlayStack.getSnapshot,
    overlayStack.getSnapshot,
  );
  const isTop = id !== null && entries.at(-1)?.id === id;

  const close = useCallback(() => {
    if (id) overlayStack.close(id);
    else onCloseRef.current?.();
  }, [id]);

  return { id, zIndex: overlayZIndex(level), setFloating, isTop, close };
}

/** 訂閱整個堆疊（例如要畫遮罩、或判斷目前有沒有 modal）。 */
export function useOverlayStack(): readonly OverlayEntry[] {
  return useSyncExternalStore(
    overlayStack.subscribe,
    overlayStack.getSnapshot,
    overlayStack.getSnapshot,
  );
}
