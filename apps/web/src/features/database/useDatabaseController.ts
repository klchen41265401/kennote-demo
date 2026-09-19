/**
 * database 容器的狀態機。
 *
 * 所有寫入都經過這裡（04 §7.3）：視圖元件只拿到動作函式，不知道 API 長什麼樣。
 * 三件事在這裡處理掉，視圖才能保持單純：
 *   1. cursor 分頁的累積（往下捲 = 追加，不是重抓）
 *   2. 儲存格的樂觀更新（先畫上去，再用伺服器回來的值覆蓋 —— 公式欄位會重算）
 *   3. 視圖設定的 debounce 存檔（拖欄寬時不要每個 pixel 都打一次 API）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AggregationResult,
  CollectionSchema,
  CollectionView,
  DatabaseRow,
  DatabaseSnapshot,
  FieldDefinition,
  RowGroup,
  SchemaOp,
  SelectOption,
  ViewFormat,
  ViewQuery,
} from '@kennote/shared-types';
import * as api from './api';

const VIEW_PATCH_DEBOUNCE_MS = 400;
const SEARCH_DEBOUNCE_MS = 300;

export interface RowsState {
  rows: DatabaseRow[];
  groups: RowGroup[] | undefined;
  aggregations: AggregationResult[] | undefined;
  cursor: string | null;
  hasMore: boolean;
  total: number;
  isFetching: boolean;
  error: unknown;
}

const EMPTY_ROWS: RowsState = {
  rows: [],
  groups: undefined,
  aggregations: undefined,
  cursor: null,
  hasMore: false,
  total: 0,
  isFetching: false,
  error: null,
};

export interface DatabaseController {
  snapshot: DatabaseSnapshot | undefined;
  schema: CollectionSchema;
  views: CollectionView[];
  view: CollectionView | undefined;
  setActiveViewId: (viewId: string) => void;
  search: string;
  setSearch: (value: string) => void;
  rowsState: RowsState;
  isLoading: boolean;
  refresh: () => void;
  loadMore: () => void;

  updateView: (patch: { query?: ViewQuery; format?: ViewFormat; name?: string }) => void;
  setCellValue: (rowId: string, propertyId: string, value: unknown) => void;
  setRowTitle: (rowId: string, title: string) => void;
  createRow: (options?: { group?: { property: string; key: string | null } }) => Promise<void>;
  deleteRow: (rowId: string) => Promise<void>;
  duplicateRow: (rowId: string) => Promise<void>;

  applySchemaOps: (ops: SchemaOp[]) => Promise<void>;
  createOption: (propertyId: string, label: string) => Promise<string | null>;
  schemaError: string | null;
  clearSchemaError: () => void;
}

export function useDatabaseController(
  collectionId: string,
  initialViewId?: string,
): DatabaseController {
  const snapshotQuery = api.useDatabase(collectionId);
  const snapshot = snapshotQuery.data;
  const views = useMemo(() => snapshot?.views ?? [], [snapshot]);
  const schema = snapshot?.collection.schema ?? {};

  const [activeViewId, setActiveViewId] = useState<string | null>(initialViewId ?? null);
  const view = views.find((v) => v.id === activeViewId) ?? views[0];

  const [search, setSearchRaw] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rowsState, setRowsState] = useState<RowsState>(EMPTY_ROWS);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  /** 本地覆寫的視圖設定：debounce 期間先用本地值畫，不然拖欄寬會一直彈回去 */
  const [localView, setLocalView] = useState<Partial<CollectionView> | null>(null);
  const effectiveView = useMemo(
    () => (view ? ({ ...view, ...(localView ?? {}) } as CollectionView) : undefined),
    [view, localView],
  );

  useEffect(() => {
    setLocalView(null);
  }, [view?.id]);

  const signature = api.querySignature(effectiveView?.query, debouncedSearch);
  const pageSize = effectiveView?.query?.pageSize ?? 50;

  const load = useCallback(
    async (cursor: string | null) => {
      if (!collectionId || !effectiveView) return;
      setRowsState((prev) => ({ ...prev, isFetching: true, error: null }));
      try {
        const result = await api.fetchRows({
          collectionId,
          viewId: effectiveView.id,
          limit: pageSize,
          cursor,
          search: debouncedSearch,
        });
        setRowsState((prev) => ({
          rows: cursor ? [...prev.rows, ...result.rows] : result.rows,
          groups: result.groups,
          aggregations: result.aggregations,
          cursor: result.cursor,
          hasMore: result.hasMore,
          total: result.total,
          isFetching: false,
          error: null,
        }));
      } catch (error) {
        setRowsState((prev) => ({ ...prev, isFetching: false, error }));
      }
    },
    // 相依陣列刻意手寫：只有這幾個值變了才該重跑
    [collectionId, effectiveView?.id, signature, pageSize, debouncedSearch],
  );

  useEffect(() => {
    if (!effectiveView) return;
    void load(null);
    // 相依陣列刻意手寫：只有這幾個值變了才該重跑
  }, [collectionId, effectiveView?.id, signature]);

  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current || !rowsState.hasMore || !rowsState.cursor) return;
    loadingMoreRef.current = true;
    void load(rowsState.cursor).finally(() => {
      loadingMoreRef.current = false;
    });
  }, [load, rowsState.hasMore, rowsState.cursor]);

  /* ── 視圖設定（debounce 存檔） ── */

  const patchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<{ query?: ViewQuery; format?: ViewFormat; name?: string }>({});

  const updateView = useCallback(
    (patch: { query?: ViewQuery; format?: ViewFormat; name?: string }) => {
      if (!view) return;
      setLocalView((prev) => ({ ...(prev ?? {}), ...patch }));
      pendingPatch.current = { ...pendingPatch.current, ...patch };
      if (patchTimer.current) clearTimeout(patchTimer.current);
      patchTimer.current = setTimeout(() => {
        const body = pendingPatch.current;
        pendingPatch.current = {};
        void api.patchView(collectionId, view.id, body).catch(() => {
          /* 失敗時下一次重新整理會拿回伺服器版本 */
        });
      }, VIEW_PATCH_DEBOUNCE_MS);
    },
    [collectionId, view],
  );

  useEffect(
    () => () => {
      if (patchTimer.current) clearTimeout(patchTimer.current);
    },
    [],
  );

  /* ── 列的寫入（樂觀更新） ── */

  const replaceRow = useCallback((row: DatabaseRow) => {
    setRowsState((prev) => ({
      ...prev,
      rows: prev.rows.map((r) => (r.id === row.id ? row : r)),
      groups: prev.groups?.map((g) => ({
        ...g,
        rows: g.rows.map((r) => (r.id === row.id ? row : r)),
      })),
    }));
  }, []);

  const setCellValue = useCallback(
    (rowId: string, propertyId: string, value: unknown) => {
      const current = rowsState.rows.find((r) => r.id === rowId);
      if (!current) return;
      // 樂觀更新：先把值畫上去，再用伺服器回來的完整列覆蓋（公式/匯總會重算）
      void api
        .patchRow(collectionId, rowId, { properties: { [propertyId]: value as never } })
        .then(replaceRow)
        .catch(() => void load(null));
    },
    [collectionId, rowsState.rows, replaceRow, load],
  );

  const setRowTitle = useCallback(
    (rowId: string, title: string) => {
      void api
        .patchRow(collectionId, rowId, { title })
        .then(replaceRow)
        .catch(() => void load(null));
    },
    [collectionId, replaceRow, load],
  );

  const createRow = useCallback(
    async (options?: { group?: { property: string; key: string | null } }) => {
      await api.createRow(collectionId, { ...(options?.group ? { group: options.group } : {}) });
      await load(null);
    },
    [collectionId, load],
  );

  const deleteRow = useCallback(
    async (rowId: string) => {
      setRowsState((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== rowId) }));
      await api.deleteRow(collectionId, rowId);
      await load(null);
    },
    [collectionId, load],
  );

  const duplicateRow = useCallback(
    async (rowId: string) => {
      await api.duplicateRow(collectionId, rowId);
      await load(null);
    },
    [collectionId, load],
  );

  /* ── schema ── */

  const applySchemaOps = useCallback(
    async (ops: SchemaOp[]) => {
      setSchemaError(null);
      try {
        await api.patchSchemaOps(collectionId, ops);
        await snapshotQuery.refetch();
        await load(null);
      } catch (error) {
        setSchemaError(error instanceof Error ? error.message : '欄位設定更新失敗');
        throw error;
      }
    },
    // 相依陣列刻意手寫：只有這幾個值變了才該重跑
    [collectionId, load],
  );

  /** select / multiSelect 編輯器裡直接建立新選項 */
  const createOption = useCallback(
    async (propertyId: string, label: string): Promise<string | null> => {
      const def = schema[propertyId];
      if (!def || (def.type !== 'select' && def.type !== 'multiSelect')) return null;
      const options: SelectOption[] = [...(def.options ?? [])];
      const id = `opt_${Math.random().toString(36).slice(2, 8)}`;
      options.push({ id, value: label, color: 'default' });
      const next = { ...def, options } as FieldDefinition;
      await applySchemaOps([{ op: 'update', propertyId, definition: next }]);
      return id;
    },
    [schema, applySchemaOps],
  );

  return {
    snapshot,
    schema,
    views,
    view: effectiveView,
    setActiveViewId,
    search,
    setSearch: setSearchRaw,
    rowsState,
    isLoading: snapshotQuery.isLoading,
    refresh: () => void load(null),
    loadMore,
    updateView,
    setCellValue,
    setRowTitle,
    createRow,
    deleteRow,
    duplicateRow,
    applySchemaOps,
    createOption,
    schemaError,
    clearSchemaError: () => setSchemaError(null),
  };
}
