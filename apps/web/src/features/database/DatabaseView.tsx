/**
 * database 的容器（02 §3.5 的 DatabaseView）。
 *
 * 職責：載入 schema 與視圖設定 → 依 view.type 分派給 view registry →
 * 統籌 filter/sort/group 的套用與查詢請求 → 提供所有寫入動作。
 *
 * 整頁（DatabaseRoute）與內嵌（InlineDatabase）用的是**同一支元件**，
 * 差別只有外框（01 §5.3 M4.3.10：同資料源、不同外框，狀態共用）。
 */
import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { richTextToPlainText } from '@kennote/shared-types';
import * as api from './api';
import { DatabaseContext, type DatabaseContextValue } from './context';
import { DatabaseHeader } from './DatabaseHeader';
import { useDatabaseController } from './useDatabaseController';
/* side peek 現在是 URL 狀態（`?p=&pm=`），面板本身掛在 App 上的 `<PeekHost>`。
   這裡只負責「照視圖設定決定用哪一種方式開」＋「把列資料註冊給 peek」。
   ⚠️ 只 import 這兩支葉節點檔案，不要 import `features/peek/index`（會循環）。 */
import { registerPeekRowSource, releasePeekRowSource } from '../peek/peek-store';
import { usePeekNavigation, usePeekState } from '../peek/peek-url';
import { getViewType } from './views/index';
import styles from './DatabaseView.module.css';

export interface DatabaseViewProps {
  collectionId: string;
  /** 指定一開始顯示哪個視圖（內嵌 block 會帶） */
  viewId?: string;
  /** 內嵌於頁面 vs 整頁模式（02 §3.5 的 props） */
  inline?: boolean;
  readOnly?: boolean;
  /** 內嵌時的高度上限 */
  maxHeight?: number;
}

export function DatabaseView({
  collectionId,
  viewId,
  inline = false,
  readOnly = false,
  maxHeight,
}: DatabaseViewProps) {
  const controller = useDatabaseController(collectionId, viewId);
  const navigate = useNavigate();
  const workspaceId = controller.snapshot?.collection.workspaceId ?? '';
  const members = api.useWorkspaceMembers(workspaceId || null);
  const peek = usePeekState();
  const peekNav = usePeekNavigation();

  /**
   * B-3「開啟頁面方式」：存在 view 上（`format.openPageIn`），
   * 沒設過就是 Notion 的預設「側邊預覽」。所有視圖（表格 / 看板 / 清單 /
   * 圖庫 / 日曆 / 時程表）點列都走這一條。
   */
  const openPageIn = controller.view?.format?.openPageIn ?? 'side';
  const openRow = useMemo(
    () => (rowId: string) => peekNav.open(rowId, openPageIn),
    [peekNav, openPageIn],
  );

  const context: DatabaseContextValue = useMemo(
    () => ({
      collectionId,
      workspaceId,
      schema: controller.schema,
      members: members.data ?? [],
      createOption: controller.createOption,
      openRow,
      openRowPage: (rowId) => navigate(`/page/${rowId}`),
      applySchemaOps: controller.applySchemaOps,
      readOnly,
    }),
    // 相依陣列刻意手寫：只有這幾個值變了才該重跑
    [collectionId, workspaceId, controller.schema, members.data, readOnly, openRow],
  );

  /**
   * 把「列」註冊給 peek。
   *
   * peek 是 URL 狀態、面板只有一份（掛在 App 上的 `<PeekHost>`），
   * 但「上一列 / 下一列」（§C-4）與屬性表（§C-5）需要 controller 手上的資料。
   * 所以：網址上的 `p` 如果是**我這個視圖的某一列**，就把資料與寫入 callback
   * 註冊進去；不是的話什麼都不做（inline database 有多個實例，靠 token 防互踢）。
   */
  const peekToken = useRef({}).current;
  const peekRows = controller.rowsState.rows;
  const ownsPeek = peek.pageId ? peekRows.some((r) => r.id === peek.pageId) : false;

  useEffect(() => {
    if (!ownsPeek) return undefined;
    registerPeekRowSource({
      token: peekToken,
      context,
      rowIds: peekRows.map((r) => r.id),
      getRow: (rowId) => peekRows.find((r) => r.id === rowId),
      setCellValue: (rowId, propertyId, value) =>
        controller.setCellValue(rowId, propertyId, value),
      deleteRow: (rowId) => void controller.deleteRow(rowId),
      duplicateRow: (rowId) => void controller.duplicateRow(rowId),
    });
    return () => releasePeekRowSource(peekToken);
    // 相依陣列刻意手寫：controller 的動作是穩定的，只有列 / context 變了才要重註冊
  }, [ownsPeek, peekRows, context, peekToken]);

  /**
   * peek 裡的 `<PageHeader>` 改標題走的是 `PATCH /api/pages/:id`（跟整頁開啟同一條），
   * 那條路不會動到 rows 的查詢快取。所以 peek 一關就重抓一次列，
   * 表格 / 看板上的標題才不會停在舊值。
   */
  const peekWasOpen = useRef(false);
  const ownsPeekRef = useRef(false);
  ownsPeekRef.current = ownsPeek;
  useEffect(() => {
    const open = Boolean(peek.pageId);
    if (peekWasOpen.current && !open && ownsPeekRef.current) controller.refresh();
    peekWasOpen.current = open;
    // 相依陣列刻意手寫：只看 peek 開 / 關這一件事
  }, [peek.pageId]);

  if (controller.isLoading) {
    return <div className={styles.placeholder}>載入資料庫中…</div>;
  }
  if (!controller.snapshot || !controller.view) {
    return <div className={styles.placeholder}>找不到這個資料庫，可能已被刪除。</div>;
  }

  const view = controller.view;
  const viewDef = getViewType(view.type);
  const ViewComponent = viewDef.Component;
  const { rowsState } = controller;

  return (
    <DatabaseContext.Provider value={context}>
      <section
        className={inline ? styles.inline : styles.page}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <DatabaseHeader
          title={richTextToPlainText(controller.snapshot.collection.name) || '未命名資料庫'}
          schema={controller.schema}
          views={controller.views}
          view={view}
          groups={rowsState.groups}
          search={controller.search}
          readOnly={readOnly}
          inline={inline}
          onSelectView={controller.setActiveViewId}
          onUpdateView={controller.updateView}
          onSearch={controller.setSearch}
          onCreateRow={() => void controller.createRow()}
          onExportCsv={() => void api.downloadCsv(collectionId, view.id)}
          {...(inline && controller.snapshot.collection.pageId
            ? { onExpand: () => navigate(`/page/${controller.snapshot?.collection.pageId ?? ''}`) }
            : {})}
          onChangeViewType={(type) => {
            // 切換視圖型別時補上該型別的預設外觀（例如看板的欄寬）
            const def = getViewType(type);
            void api
              .patchView(collectionId, view.id, {
                type,
                format: { ...def.defaultFormat(controller.schema), ...view.format },
              })
              .then(() => controller.refresh());
          }}
          onCreateView={(type) => {
            const def = getViewType(type);
            void api
              .createView(collectionId, {
                type,
                name: def.label,
                format: def.defaultFormat(controller.schema),
              })
              .then((created) => controller.setActiveViewId(created.id));
          }}
          onDuplicateView={() => {
            void api
              .duplicateView(collectionId, view.id)
              .then((created) => controller.setActiveViewId(created.id));
          }}
          onDeleteView={() => {
            void api.deleteView(collectionId, view.id).then(() => {
              const next = controller.views.find((v) => v.id !== view.id);
              if (next) controller.setActiveViewId(next.id);
            });
          }}
        />

        {controller.schemaError ? (
          <p className={styles.error} role="alert">
            {controller.schemaError}
            <button type="button" onClick={controller.clearSchemaError}>
              知道了
            </button>
          </p>
        ) : null}

        <div className={styles.viewport}>
          <ViewComponent
            view={view}
            schema={controller.schema}
            rows={rowsState.rows}
            groups={rowsState.groups}
            aggregations={rowsState.aggregations}
            hasMore={rowsState.hasMore}
            isFetching={rowsState.isFetching}
            loadMore={controller.loadMore}
            updateView={controller.updateView}
            setCellValue={controller.setCellValue}
            setRowTitle={controller.setRowTitle}
            createRow={(options) => void controller.createRow(options)}
            deleteRow={(rowId) => void controller.deleteRow(rowId)}
            duplicateRow={(rowId) => void controller.duplicateRow(rowId)}
            deleteRows={(rowIds) => void controller.deleteRows(rowIds)}
            reorderRow={(rowId, afterId) => void controller.reorderRow(rowId, afterId)}
            openRow={openRow}
          />
        </div>

        {rowsState.rows.length === 0 && !rowsState.isFetching ? (
          <p className={styles.empty}>還沒有資料。按右上角的「新增」建立第一列。</p>
        ) : null}
      </section>

    </DatabaseContext.Provider>
  );
}
