/**
 * database 的容器（02 §3.5 的 DatabaseView）。
 *
 * 職責：載入 schema 與視圖設定 → 依 view.type 分派給 view registry →
 * 統籌 filter/sort/group 的套用與查詢請求 → 提供所有寫入動作。
 *
 * 整頁（DatabaseRoute）與內嵌（InlineDatabase）用的是**同一支元件**，
 * 差別只有外框（01 §5.3 M4.3.10：同資料源、不同外框，狀態共用）。
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { richTextToPlainText } from '@kennote/shared-types';
import * as api from './api';
import { DatabaseContext, type DatabaseContextValue } from './context';
import { DatabaseHeader } from './DatabaseHeader';
import { RowPeek } from './RowPeek';
import { useDatabaseController } from './useDatabaseController';
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
  const [peekRowId, setPeekRowId] = useState<string | null>(null);

  const context: DatabaseContextValue = useMemo(
    () => ({
      collectionId,
      workspaceId,
      schema: controller.schema,
      members: members.data ?? [],
      createOption: controller.createOption,
      openRow: (rowId) => setPeekRowId(rowId),
      openRowPage: (rowId) => navigate(`/page/${rowId}`),
      applySchemaOps: controller.applySchemaOps,
      readOnly,
    }),
    // 相依陣列刻意手寫：只有這幾個值變了才該重跑
    [collectionId, workspaceId, controller.schema, members.data, readOnly],
  );

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
  const peekRow = rowsState.rows.find((r) => r.id === peekRowId);

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
            openRow={(rowId) => setPeekRowId(rowId)}
          />
        </div>

        {rowsState.rows.length === 0 && !rowsState.isFetching ? (
          <p className={styles.empty}>還沒有資料。按右上角的「新增」建立第一列。</p>
        ) : null}
      </section>

      {peekRow ? (
        <RowPeek
          row={peekRow}
          open
          onClose={() => setPeekRowId(null)}
          onSetCellValue={(propertyId, value) =>
            controller.setCellValue(peekRow.id, propertyId, value)
          }
          onSetTitle={(title) => controller.setRowTitle(peekRow.id, title)}
          onDelete={() => void controller.deleteRow(peekRow.id)}
          onDuplicate={() => void controller.duplicateRow(peekRow.id)}
        />
      ) : null}
    </DatabaseContext.Provider>
  );
}
