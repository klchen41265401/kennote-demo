/**
 * 給其他 feature 模組「掛進編輯器」的擴充點。
 *
 * 為什麼用 runtime 註冊而不是直接 import：
 * `features/database` 由另一位代理並行開發，寫這支的時候還不存在。
 * 直接 import 會讓 typecheck 整個掛掉；用註冊表的話，資料庫模組
 * 只要在自己的進入點呼叫一次 `registerInlineDatabase(InlineDatabase)`，
 * 編輯器就會自動用它取代佔位卡，編輯器這邊一行都不用改。
 *
 * ```ts
 * // apps/web/src/features/database/index.ts
 * import { registerInlineDatabase } from '../editor/blocks/externalRegistry';
 * registerInlineDatabase(InlineDatabase);
 * ```
 */
import type { ComponentType } from 'react';

export interface InlineDatabaseProps {
  collectionId: string;
  viewIds: string[];
  /** 這個 collectionView block 的 id（database 模組要回寫 viewIds 時用） */
  blockId: string;
  onChange(patch: { collectionId?: string | null; viewIds?: string[] }): void;
}

let inlineDatabase: ComponentType<InlineDatabaseProps> | null = null;
const listeners = new Set<() => void>();

export function registerInlineDatabase(component: ComponentType<InlineDatabaseProps>): void {
  inlineDatabase = component;
  for (const cb of [...listeners]) cb();
}

export function getInlineDatabaseComponent(): ComponentType<InlineDatabaseProps> | null {
  return inlineDatabase;
}

export function onExternalRegistryChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * 建立資料庫的實作（`POST /api/databases`）也由 database 模組提供。
 * 沒註冊時編輯器只顯示佔位卡，不會壞掉。
 */
export type CreateDatabaseFn = (input: {
  workspaceId: string;
  parentId: string | null;
}) => Promise<{ collectionId: string; viewIds: string[] }>;

let createDatabaseImpl: CreateDatabaseFn | null = null;

export function registerCreateDatabase(fn: CreateDatabaseFn): void {
  createDatabaseImpl = fn;
}

export function getCreateDatabase(): CreateDatabaseFn | null {
  return createDatabaseImpl;
}
