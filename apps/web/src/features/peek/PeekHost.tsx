/**
 * `<PeekHost>` —— 全 App 唯一的一份 peek（gap-review §B-1 / §B-2 / §C-1 / §C-4）。
 *
 * 掛在 `App.tsx` 的 Router 底下、`AppShell` 外面（一行）。
 * 它只做三件事：
 *   1. 讀網址上的 `?p=<pageId>&pm=s|c` → 決定開不開、開哪一種
 *   2. 問 `peek-store`「這個 pageId 是不是某個資料庫視圖的列」
 *      → 是就多畫一張屬性表 + 上一頁 / 下一頁；不是就當成一般頁面預覽
 *   3. 內容一律是 `<PageHeader>` + `<Editor pageId>` —— 跟整頁開啟**同一支元件、
 *      同一條同步層**，所以 peek 裡改的就是那一頁本身
 *
 * ⚠️ 不是 modal：Escape 關閉，但沒有 focus trap、沒有捲動鎖、背景沒有 `inert`。
 */
import { useEffect, useMemo } from 'react';
import { toast } from '@kennote/ui';
import { Editor } from '../editor/Editor';
import { PageHeader } from '../editor/PageHeader';
import { EditableCell } from '../database/EditableCell';
import { DatabaseContext } from '../database/context';
import { FieldIcon } from '../database/_fallback';
import { getFieldType } from '../database/fields/types';
import { usePage, usePageSnapshot } from '../../lib/queries';
import { useAuth } from '../../stores/auth';
import { SidePeek, type PeekAction } from './SidePeek';
import { usePeekNavigation, usePeekState } from './peek-url';
import { usePeekRowSource } from './peek-store';
import styles from './Peek.module.css';
import './peek-layout.css';

export function PeekHost(): JSX.Element | null {
  const { pageId, mode } = usePeekState();
  const nav = usePeekNavigation();
  const source = usePeekRowSource(pageId);
  /*
   * `PeekHost` 掛在 `ProtectedRoute` **外面**（換 route 不卸載），
   * 所以冷啟動（重整 / 直接貼網址帶 `?p=`）時它會比 auth bootstrap 還早跑。
   * 這時候去打 `GET /api/pages/:id` 必然 401，而且 401 會觸發第二次 /refresh ——
   * 後端的 refresh token 有重用偵測，併發兩次會撤銷整個 session（使用者被登出）。
   * api-client 已經把 refresh 收斂成單一 in-flight，這裡再補一層：
   * bootstrap 還沒結束就先畫外框、**不要發請求**。
   */
  const { status } = useAuth();

  /* Escape 關閉。用 capture=false，讓 peek 裡開著的 Popover / Menu 先吃掉它。 */
  useEffect(() => {
    if (!pageId) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      nav.close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pageId, nav]);

  const siblings = source?.rowIds ?? [];
  const index = pageId ? siblings.indexOf(pageId) : -1;
  const prevId = index > 0 ? siblings[index - 1] : undefined;
  const nextId = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;

  const actions = useMemo<PeekAction[]>(() => {
    if (!source || !pageId || source.context.readOnly) return [];
    return [
      { label: '建立複本', onSelect: () => source.duplicateRow(pageId) },
      {
        label: '移至垃圾桶',
        danger: true,
        onSelect: () => {
          source.deleteRow(pageId);
          nav.close();
        },
      },
    ];
  }, [source, pageId, nav]);

  if (!pageId) return null;
  // 沒登入（會被 `ProtectedRoute` 導去 /login）就不要在登入頁上疊一個空的 peek
  if (status === 'anonymous') return null;

  return (
    <SidePeek
      mode={mode}
      onClose={nav.close}
      onChangeMode={nav.setMode}
      onOpenInNewTab={() => nav.openInNewTab(pageId)}
      onCopyLink={() => {
        void navigator.clipboard?.writeText(window.location.href);
        toast.success('已複製連結');
      }}
      onPrev={prevId ? () => nav.open(prevId, mode) : null}
      onNext={nextId ? () => nav.open(nextId, mode) : null}
      actions={actions}
    >
      {status === 'authenticated' ? (
        <PeekBody key={pageId} pageId={pageId} />
      ) : (
        <p className={styles.placeholder}>載入中…</p>
      )}
    </SidePeek>
  );
}

/**
 * peek 的內容。`key={pageId}` 讓換一列就整棵重建 ——
 * `useEditorHost` 的 cleanup 會把上一頁的 editor-core 銷毀，不會留孤兒監聽器。
 */
function PeekBody({ pageId }: { pageId: string }): JSX.Element {
  const page = usePage(pageId);
  const snapshot = usePageSnapshot(pageId);
  const nav = usePeekNavigation();
  const { mode } = usePeekState();
  const source = usePeekRowSource(pageId);
  const row = source?.getRow(pageId);

  if (!page.data) {
    return <p className={styles.placeholder}>載入中…</p>;
  }

  const workspaceId = page.data.workspaceId;
  const readOnly = source?.context.readOnly ?? false;

  const properties =
    source && row
      ? Object.entries(source.context.schema).filter(([id]) => id !== 'title')
      : [];

  return (
    <>
      <PageHeader page={page.data} workspaceId={workspaceId} readOnly={readOnly} />

      {source && row && properties.length > 0 ? (
        /* 屬性表的儲存格要拿 schema / 成員 / 建選項 —— 直接把 DatabaseView 的
           context 接過來，不要在這裡重造一份半殘的。 */
        <DatabaseContext.Provider value={source.context}>
          <dl className={styles.properties}>
            {properties.map(([propertyId, def]) => {
              if (!def) return null;
              const fieldType = getFieldType(def.type);
              return (
                <div key={propertyId} style={{ display: 'contents' }}>
                  <dt>
                    <button
                      type="button"
                      className={styles.propertyName}
                      title={def.name}
                      /* §C-5：Notion 的屬性名是可點的按鈕；欄位設定面板還沒接上來，
                         先讓它可聚焦（鍵盤走得到），點擊不做事。 */
                      onClick={() => undefined}
                    >
                      <FieldIcon type={def.type} />
                      <span>{def.name}</span>
                    </button>
                  </dt>
                  <dd className={styles.propertyValue}>
                    <EditableCell
                      propertyId={propertyId}
                      def={def}
                      row={row}
                      value={row.properties[propertyId]}
                      readOnly={readOnly || fieldType.computed}
                      onCommit={(value) => source.setCellValue(pageId, propertyId, value)}
                    />
                  </dd>
                </div>
              );
            })}
          </dl>
        </DatabaseContext.Provider>
      ) : null}

      {/* ⭐ 與整頁開啟共用同一支 <Editor> 與同一條同步層。
          `id="editor-host-row"` 是 features/database/README §4 對外的掛載點約定，保留。 */}
      <div id="editor-host-row" className={styles.editorHost} data-page-id={pageId}>
        {snapshot.isLoading && !snapshot.data ? (
          <p className={styles.placeholder}>載入內容中…</p>
        ) : (
          <Editor
            pageId={pageId}
            workspaceId={workspaceId}
            snapshot={snapshot.data}
            readOnly={readOnly}
            /* peek 裡點到頁面連結：**換 peek 的內容**，不要在 peek 裡疊第二層 */
            onNavigateToPage={(next) => nav.open(next, mode)}
          />
        )}
      </div>
    </>
  );
}
