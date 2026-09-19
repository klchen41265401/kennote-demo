import { Fragment, useCallback, type ReactNode } from 'react';
import { useDraggable } from './useDraggable.js';
import { useDroppable } from './useDroppable.js';
import type { DropResult } from './controller.js';
import type { ComputeDropTargetOptions } from './computeDropTarget.js';

export interface SortableRenderProps {
  /** 掛到項目根元素。 */
  setNodeRef: (node: HTMLElement | null) => void;
  /** 掛到 drag handle（可以是整個項目，也可以只是 ⠿ 把手）。 */
  handleProps: ReturnType<typeof useDraggable>['handleProps'];
  isDragging: boolean;
  index: number;
}

export interface SortableListProps<T> {
  id: string;
  items: readonly T[];
  getId: (item: T, index: number) => string;
  /** 項目的縮排層級（頁面樹用）。 */
  getDepth?: (item: T, index: number) => number;
  /** 項目能不能收子項；false 時不會出現 'inside' 落點。 */
  getAcceptsChildren?: (item: T, index: number) => boolean;
  kind?: string;
  /** 'list' 只有 before/after；'tree' 多一個 inside，預設 'list'。 */
  mode?: ComputeDropTargetOptions['mode'];
  dropOptions?: ComputeDropTargetOptions;
  /** 放開時呼叫。from / to 皆為陣列索引；position 為 'inside' 時代表成為 to 的子項。 */
  onReorder?: (change: {
    from: number;
    to: number;
    position: 'before' | 'inside' | 'after';
    depth: number;
    result: DropResult;
  }) => void;
  className?: string;
  children: (item: T, props: SortableRenderProps) => ReactNode;
}

/**
 * useDraggable + useDroppable 的便利包裝。
 * 適用於 block 排序、頁面樹、看板欄等「一維可排序清單」。
 */
export function SortableList<T>(props: SortableListProps<T>): JSX.Element {
  const {
    id,
    items,
    getId,
    getDepth,
    getAcceptsChildren,
    kind = `sortable:${id}`,
    mode = 'list',
    dropOptions,
    onReorder,
    className,
    children,
  } = props;

  const ids = items.map((item, i) => getId(item, i));

  const handleDrop = useCallback(
    (result: DropResult) => {
      const from = ids.indexOf(result.sourceId);
      const to = result.target.itemIndex;
      if (from === -1 || to === -1) return;
      onReorder?.({
        from,
        to,
        position: result.target.position,
        depth: result.target.depth,
        result,
      });
    },
    [ids, onReorder],
  );

  const droppable = useDroppable({
    id,
    accepts: [kind],
    orientation: 'vertical',
    dropOptions: { mode, ...dropOptions },
    onDrop: handleDrop,
  });

  return (
    <div ref={droppable.setNodeRef} className={className} data-kn-sortable={id}>
      {items.map((item, index) => (
        <SortableItem
          key={getId(item, index)}
          itemId={getId(item, index)}
          kind={kind}
          index={index}
          depth={getDepth?.(item, index) ?? 0}
          acceptsChildren={getAcceptsChildren?.(item, index) ?? mode === 'tree'}
        >
          {(renderProps) => <Fragment>{children(item, renderProps)}</Fragment>}
        </SortableItem>
      ))}
    </div>
  );
}

interface SortableItemProps {
  itemId: string;
  kind: string;
  index: number;
  depth: number;
  acceptsChildren: boolean;
  children: (props: SortableRenderProps) => ReactNode;
}

function SortableItem({
  itemId,
  kind,
  index,
  depth,
  acceptsChildren,
  children,
}: SortableItemProps): JSX.Element {
  const { setNodeRef, handleProps, isDragging } = useDraggable({ id: itemId, kind, data: { index } });
  const attach = useCallback(
    (node: HTMLElement | null) => {
      if (node) {
        node.dataset['knDndItem'] = '';
        node.dataset['id'] = itemId;
        node.dataset['depth'] = String(depth);
        node.dataset['acceptsChildren'] = String(acceptsChildren);
      }
      setNodeRef(node);
    },
    [setNodeRef, itemId, depth, acceptsChildren],
  );
  return <>{children({ setNodeRef: attach, handleProps, isDragging, index })}</>;
}
