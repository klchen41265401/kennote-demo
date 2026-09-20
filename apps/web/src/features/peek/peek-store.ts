/**
 * 「這個 peek 現在正被哪個資料庫視圖擁有」的小註冊表。
 *
 * 為什麼需要它：peek 是 **URL 狀態**（`?p=…`），所以面板只有一份、掛在 `<App>` 上
 * （`PeekHost`）。但列頁要多畫一張屬性表、頂部要有「上一頁 / 下一頁」，
 * 這些資料只有 `DatabaseView` 的 controller 有。
 *
 * 於是：`DatabaseView` 發現「網址上的 `p` 是我這個視圖的某一列」時就把
 * 一組取值 / 寫入的 callback 註冊進來，`PeekHost` 讀得到就多畫屬性表與翻列鈕，
 * 讀不到就退化成一般頁面的 peek（`features/editor` 的 `<PageHeader>` + `<Editor>`）。
 *
 * 刻意不用 store 套件：這裡只有一個值、一個版本號，`useSyncExternalStore` 就夠。
 */
import { useSyncExternalStore } from 'react';
import type { DatabaseRow } from '@kennote/shared-types';
// ⚠️ 只能 type-only import：`DatabaseView` 反過來會 import 這支檔案，
// 值的 import 會變成 runtime 循環相依。
import type { DatabaseContextValue } from '../database/context';

export interface PeekRowSource {
  /** 註冊者的識別（`release` 時用來確認自己還是擁有者，避免互踢） */
  token: object;
  /** `DatabaseView` 建好的 context（屬性表的儲存格要靠它拿 schema / 成員 / 建選項） */
  context: DatabaseContextValue;
  /** 目前視圖的列順序 —— 「上一頁 / 下一頁」照這個走 */
  rowIds: string[];
  getRow: (rowId: string) => DatabaseRow | undefined;
  setCellValue: (rowId: string, propertyId: string, value: unknown) => void;
  deleteRow: (rowId: string) => void;
  duplicateRow: (rowId: string) => void;
}

let current: PeekRowSource | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerPeekRowSource(source: PeekRowSource): void {
  current = source;
  emit();
}

/** 只有「我還是目前的擁有者」時才清掉（inline database 有多個實例） */
export function releasePeekRowSource(token: object): void {
  if (current?.token !== token) return;
  current = null;
  emit();
}

/** 這個 pageId 是不是某個資料庫視圖的列？是的話回傳它的資料來源 */
export function usePeekRowSource(pageId: string | null): PeekRowSource | null {
  useSyncExternalStore(
    subscribe,
    () => version,
    () => version,
  );
  if (!pageId || !current) return null;
  return current.rowIds.includes(pageId) ? current : null;
}
