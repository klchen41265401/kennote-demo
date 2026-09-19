/**
 * 上傳進度的小型 store。
 *
 * 為什麼不存進 block.props：上傳進度是**本機 UI 狀態**，不該進 model、
 * 不該被同步到別人的瀏覽器、更不該進 undo stack。
 * 貼上 / 拖放檔案時由 Editor 寫入，media renderer 訂閱顯示。
 */
import { useEffect, useState } from 'react';

const progress = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const cb of [...listeners]) cb();
}

export function setUploadProgress(blockId: string, percent: number | null): void {
  if (percent === null) progress.delete(blockId);
  else progress.set(blockId, percent);
  emit();
}

export function getUploadProgress(blockId: string): number | null {
  return progress.get(blockId) ?? null;
}

export function useUploadProgress(blockId: string): number | null {
  const [value, setValue] = useState<number | null>(() => getUploadProgress(blockId));
  useEffect(() => {
    const update = (): void => setValue(getUploadProgress(blockId));
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, [blockId]);
  return value;
}
