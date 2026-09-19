/**
 * 最小的拖放輔助（看板卡片換組、欄位重新排序、欄寬拖曳共用）。
 *
 * 用原生 HTML5 drag and drop：不需要任何套件，而且鍵盤／螢幕閱讀器
 * 的替代路徑（選單裡的「上移／下移」）本來就得另外做。
 */
import { useCallback, useState } from 'react';

export interface DragPayload {
  kind: string;
  id: string;
  /** 來源分組（看板換組時要知道從哪一欄來的） */
  from?: string | null;
  index?: number;
}

const MIME = 'application/x-kennote-dnd';

export function useDragHandle(payload: DragPayload) {
  const [dragging, setDragging] = useState(false);

  const handlers = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(MIME, JSON.stringify(payload));
      e.dataTransfer.setData('text/plain', payload.id);
      e.dataTransfer.effectAllowed = 'move';
      setDragging(true);
    },
    onDragEnd: () => setDragging(false),
  };

  return { dragging, handlers };
}

export function readDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(MIME);
    if (!raw) return null;
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

export function useDropZone(options: {
  accept: string;
  onDrop: (payload: DragPayload, e: React.DragEvent) => void;
}) {
  const [over, setOver] = useState(false);
  const { accept, onDrop } = options;

  const onDragOver = useCallback((e: React.DragEvent) => {
    // 必須 preventDefault 才會觸發 drop
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const payload = readDragPayload(e);
      if (payload && payload.kind === accept) onDrop(payload, e);
    },
    [accept, onDrop],
  );

  return { over, handlers: { onDragOver, onDragLeave, onDrop: handleDrop } };
}

/** 陣列重排（欄位順序、排序條件優先序都用這個） */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return list;
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}
