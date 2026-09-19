/**
 * 資料庫模組的拖放（第十一輪）。
 *
 * ⭐ 這支檔案取代了 `_fallback/dnd.ts`（原生 HTML5 Drag & Drop）。
 *
 * 為什麼一定要換掉：HTML5 DnD 在行動版瀏覽器**不會由 touch 觸發**。
 * 所以第十輪之前，手機上「把看板卡片換一組」「把日曆卡片改日期」
 * 不是難用，是**根本沒有路徑**（第十輪 §4 的 9b / 9c）。
 * 而同一個 repo 裡早就有一套能用的引擎 —— `packages/ui/src/dnd`
 * （Pointer Events + 長按 400ms），時程表用的就是它。
 * 一個 repo 裡有兩套拖放引擎、其中一套在手機上不會動，
 * 那不是「還沒做手機版」，是**兩套實作各自定義了「可拖曳」是什麼意思**。
 *
 * 這裡只做「形狀轉接」，不重寫狀態機：
 *
 * | 舊（HTML5）           | 新（Pointer）                                   |
 * |---|---|
 * | `useDragHandle()`     | `useSortableItem()` / `useCardDrag()`           |
 * | `useDropZone()`       | `useSortableList()`（清單內排序）/ `useCardZone()`（整塊落點） |
 * | `dataTransfer`        | controller 的 `payload`                          |
 *
 * ⚠️ **刻意不套 `handleProps.style`**（裡面有 `touch-action: none`）。
 * 第十輪 BUG-50 講過：整列 `touch-action: none` 等於那一列不能捲，
 * 而看板欄 / 日曆格都是要捲的。正確的形狀是「平常可以捲，長按進入拖曳後才不能捲」，
 * 那件事由 controller 的 non-passive `touchmove` 負責，呼叫端不必（也不該）自己來。
 */
import { useCallback, useId, useMemo, useRef } from 'react';
import {
  useDraggable,
  useDroppable,
  type DropItemRect,
  type DropResult,
  type DropTarget,
  type Point,
} from '@kennote/ui';

/** 拖曳攜帶的資料（形狀沿用舊的 `DragPayload`，呼叫端不用改讀法）。 */
export interface DragPayload {
  kind: string;
  id: string;
  /** 來源分組（看板換組時要知道從哪一欄來的） */
  from?: string | null;
  index?: number;
}

/** 陣列重排（屬性順序、排序條件優先序都用這個） */
export function reorder<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...list];
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}

/**
 * 「整塊都是落點」的 zone（看板的一欄、日曆的一格）。
 *
 * `computeDropTarget` 是為了「在清單裡插到第幾個」設計的，
 * 看板 / 日曆要的卻是「丟進這一塊就好」—— 沒有序位的概念。
 * 所以給一個固定的合成 target：controller 只有在 `target !== null`
 * 時才會呼叫 `onDrop`，這個常數就是「我接受」的意思。
 *
 * indicator 給 0×0：視覺回饋走 zone 自己的 `isOver` class
 *（`.columnOver` / `.dayOver`），共用的落點線在這裡反而是噪音。
 */
function wholeZoneTarget(zoneId: string): DropTarget {
  return {
    id: zoneId,
    position: 'inside',
    itemIndex: 0,
    index: 0,
    depth: 0,
    indicator: { type: 'box', x: 0, y: 0, width: 0, height: 0 },
  };
}

/** 看板卡片 / 日曆卡片：整張卡就是把手。 */
export function useCardDrag(kind: string, id: string, data?: Omit<DragPayload, 'kind' | 'id'>) {
  const payload = useMemo<DragPayload>(() => ({ kind, id, ...data }), [kind, id, data?.from, data?.index]);
  const { setNodeRef, handleProps, isDragging } = useDraggable<DragPayload>({
    id: `${kind}:${id}`,
    kind,
    data: payload,
  });
  return {
    isDragging,
    dragRef: setNodeRef,
    /** 只取 onPointerDown（見檔頭：不要把 touch-action: none 套到整張卡上） */
    handleProps: { onPointerDown: handleProps.onPointerDown, draggable: false as const },
  };
}

/** 看板一欄 / 日曆一格：整塊當落點。 */
export function useCardZone(options: { accept: string; onDrop: (payload: DragPayload) => void }) {
  const zoneId = useId();
  const latest = useRef(options.onDrop);
  latest.current = options.onDrop;

  const resolveDrop = useCallback((): DropTarget => wholeZoneTarget(zoneId), [zoneId]);
  const onDrop = useCallback((result: DropResult) => {
    const payload = result.payload as DragPayload | undefined;
    if (payload) latest.current(payload);
  }, []);

  const { setNodeRef, isOver } = useDroppable({
    id: zoneId,
    accepts: [options.accept],
    resolveDrop,
    onDrop,
  });
  return { isOver, zoneRef: setNodeRef };
}

/**
 * 清單內排序（屬性清單、排序條件）。
 *
 * 舊版是「每一列自己是一個 drop zone」，換組只看「丟在誰身上」。
 * 新版改成 **整份清單一個 zone + 每一列標 `data-kn-dnd-item`**：
 * 這才是 `computeDropTarget` 的用法，也才畫得出「插在兩列之間」的那條線。
 */
export function useSortableList(options: {
  kind: string;
  /** 目前的順序（用來把 target.index 換算成 from / to） */
  ids: readonly string[];
  onReorder: (from: number, to: number) => void;
}) {
  const zoneId = useId();
  const latest = useRef(options);
  latest.current = options;

  const onDrop = useCallback((result: DropResult) => {
    const { ids, onReorder } = latest.current;
    const payload = result.payload as DragPayload | undefined;
    if (!payload) return;
    const from = ids.indexOf(payload.id);
    if (from < 0) return;
    /*
     * `target.index` 是「移除來源之前」的插入位置。
     * 往後搬的時候，來源被抽掉會讓目標索引往前一格 —— 這裡先補回來，
     * 否則「往下拖一格」會變成「原地不動」（最典型的 off-by-one）。
     */
    const to = result.target.index > from ? result.target.index - 1 : result.target.index;
    if (to === from) return;
    onReorder(from, to);
  }, []);

  const { setNodeRef, isOver } = useDroppable({
    id: zoneId,
    accepts: [options.kind],
    orientation: 'vertical',
    dropOptions: { mode: 'list' },
    onDrop,
  });
  return { isOver, listRef: setNodeRef };
}

/** 清單裡的一列。`itemProps` 一定要展開到那一列的根元素上（zone 靠它找 rect）。 */
export function useSortableItem(kind: string, id: string, index: number) {
  const { setNodeRef, handleProps, isDragging } = useDraggable<DragPayload>({
    id: `${kind}:${id}`,
    kind,
    data: { kind, id, index },
  });
  return {
    isDragging,
    dragRef: setNodeRef,
    itemProps: { 'data-kn-dnd-item': '', 'data-id': id } as const,
    handleProps: { onPointerDown: handleProps.onPointerDown, draggable: false as const },
  };
}

export type { DropItemRect, Point };
