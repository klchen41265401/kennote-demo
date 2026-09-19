/**
 * 把 database 模組掛進編輯器的擴充點（`features/editor/blocks/externalRegistry`）。
 *
 * 在這支出現之前，**沒有任何地方呼叫過 `registerInlineDatabase`**，
 * 所以頁面裡的 `collectionView` block 一律畫成「資料庫模組尚未載入」的佔位卡，
 * 內嵌資料庫等於完全沒被渲染過（視覺 QA 也因此比對不到 07-*）。
 *
 * 這裡只做「轉接」：把 externalRegistry 的 props 形狀
 * （`collectionId` / `viewIds[]` / `blockId` / `onChange`）
 * 轉成 DatabaseView 的 `viewId`（單一視圖），視圖切換由 DatabaseHeader 自己管。
 */
import { useState } from 'react';
import {
  registerCreateDatabase,
  registerInlineDatabase,
  type InlineDatabaseProps,
} from '../editor/blocks/externalRegistry';
import { createDatabase } from './api';
import { DatabaseView } from './DatabaseView';
import './fields/index';
import './views/index';

function InlineDatabaseBridge({ collectionId, viewIds }: InlineDatabaseProps): JSX.Element {
  // block props 只記「這個 block 認得哪些 view」，第一個就是預設顯示的那個
  const [initialViewId] = useState(() => viewIds[0]);
  return (
    <DatabaseView
      collectionId={collectionId}
      {...(initialViewId ? { viewId: initialViewId } : {})}
      inline
      maxHeight={560}
    />
  );
}

let done = false;

/** 冪等；App 進入點呼叫一次即可 */
export function registerDatabaseModule(): void {
  if (done) return;
  done = true;
  registerInlineDatabase(InlineDatabaseBridge);
  registerCreateDatabase(async ({ workspaceId, parentId }) => {
    const snapshot = await createDatabase({ workspaceId, parentPageId: parentId, inline: true });
    return {
      collectionId: snapshot.collection.id,
      viewIds: snapshot.views.map((v) => v.id),
    };
  });
}
