/**
 * 自研資料抓取 + 快取（04 §7.2）。不用 react-query / swr。
 *
 * 功能：
 * - key 去重（同一個 key 同時掛 N 個元件只會打一次 API）
 * - 快取 + staleTime（stale 才重抓，fresh 直接回快取）
 * - invalidate（支援前綴比對，invalidateQueries('pages') 會清掉 pages 開頭的所有 key）
 * - setQueryData（樂觀更新）
 * - 視窗重新聚焦時自動 revalidate（可關）
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export type QueryKey = string | readonly unknown[];
export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';

interface CacheEntry<T = unknown> {
  key: string;
  status: QueryStatus;
  data: T | undefined;
  error: unknown;
  updatedAt: number;
  /** 進行中的請求，用來去重 */
  promise: Promise<T> | null;
  listeners: Set<() => void>;
  /** 快照物件，參考穩定，供 useSyncExternalStore 使用 */
  snapshot: QuerySnapshot<T>;
}

export interface QuerySnapshot<T> {
  status: QueryStatus;
  data: T | undefined;
  error: unknown;
  updatedAt: number;
  isFetching: boolean;
}

export function serializeKey(key: QueryKey): string {
  if (typeof key === 'string') return key;
  return key
    .map((part) =>
      part === null || part === undefined
        ? ''
        : typeof part === 'object'
          ? JSON.stringify(part)
          : String(part),
    )
    .join('/');
}

const cache = new Map<string, CacheEntry>();

function makeSnapshot<T>(entry: CacheEntry<T>): QuerySnapshot<T> {
  return {
    status: entry.status,
    data: entry.data,
    error: entry.error,
    updatedAt: entry.updatedAt,
    isFetching: entry.promise !== null,
  };
}

function getEntry<T>(key: string): CacheEntry<T> {
  let entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    entry = {
      key,
      status: 'idle',
      data: undefined,
      error: undefined,
      updatedAt: 0,
      promise: null,
      listeners: new Set(),
      snapshot: {
        status: 'idle',
        data: undefined,
        error: undefined,
        updatedAt: 0,
        isFetching: false,
      },
    };
    cache.set(key, entry as CacheEntry);
  }
  return entry;
}

function emit<T>(entry: CacheEntry<T>): void {
  entry.snapshot = makeSnapshot(entry);
  for (const l of [...entry.listeners]) l();
}

/** 執行抓取（帶去重）。已有 in-flight 請求時直接沿用 */
function fetchQuery<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const entry = getEntry<T>(key);
  if (entry.promise) return entry.promise;

  if (entry.status === 'idle') entry.status = 'loading';
  const p = fetcher()
    .then((data) => {
      entry.data = data;
      entry.error = undefined;
      entry.status = 'success';
      entry.updatedAt = Date.now();
      return data;
    })
    .catch((err) => {
      entry.error = err;
      entry.status = 'error';
      entry.updatedAt = Date.now();
      throw err;
    })
    .finally(() => {
      entry.promise = null;
      emit(entry);
    });

  entry.promise = p;
  emit(entry);
  return p;
}

export interface UseQueryOptions<T> {
  key: QueryKey;
  fetcher: () => Promise<T>;
  /** false 時完全不抓（例如還沒登入） */
  enabled?: boolean;
  /** 多久之內視為新鮮，預設 30 秒 */
  staleTime?: number;
  /** 視窗重新聚焦時重新驗證，預設 true */
  refetchOnFocus?: boolean;
  /** 初次沒有快取時先用這份資料 */
  placeholderData?: T;
}

export interface UseQueryResult<T> {
  data: T | undefined;
  error: unknown;
  status: QueryStatus;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
  refetch: () => Promise<T | undefined>;
}

export function useQuery<T>(options: UseQueryOptions<T>): UseQueryResult<T> {
  const {
    key,
    fetcher,
    enabled = true,
    staleTime = 30_000,
    refetchOnFocus = true,
    placeholderData,
  } = options;

  const serialized = serializeKey(key);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const subscribe = useCallback(
    (listener: () => void) => {
      const entry = getEntry<T>(serialized);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    [serialized],
  );

  const getSnapshot = useCallback(() => getEntry<T>(serialized).snapshot, [serialized]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!enabled) return;
    const entry = getEntry<T>(serialized);
    const isStale = Date.now() - entry.updatedAt > staleTime;
    if (entry.status === 'idle' || (isStale && !entry.promise)) {
      void fetchQuery<T>(serialized, () => fetcherRef.current()).catch(() => {
        /* 錯誤已進 cache，交給 UI 呈現 */
      });
    }
  }, [serialized, enabled, staleTime, snapshot.status]);

  useEffect(() => {
    if (!enabled || !refetchOnFocus || typeof window === 'undefined') return;
    const onFocus = () => {
      const entry = getEntry<T>(serialized);
      if (Date.now() - entry.updatedAt > staleTime) {
        void fetchQuery<T>(serialized, () => fetcherRef.current()).catch(() => {});
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [serialized, enabled, refetchOnFocus, staleTime]);

  const refetch = useCallback(async () => {
    const entry = getEntry<T>(serialized);
    entry.promise = null;
    try {
      return await fetchQuery<T>(serialized, () => fetcherRef.current());
    } catch {
      return undefined;
    }
  }, [serialized]);

  const data = snapshot.data ?? placeholderData;

  return {
    data,
    error: snapshot.error,
    status: snapshot.status,
    isLoading: snapshot.status === 'loading' && data === undefined,
    isFetching: snapshot.isFetching,
    isSuccess: snapshot.status === 'success',
    isError: snapshot.status === 'error',
    refetch,
  };
}

/** 樂觀更新：直接寫快取，不打 API */
export function setQueryData<T>(key: QueryKey, updater: T | ((prev: T | undefined) => T)): void {
  const serialized = serializeKey(key);
  const entry = getEntry<T>(serialized);
  entry.data =
    typeof updater === 'function' ? (updater as (prev: T | undefined) => T)(entry.data) : updater;
  entry.status = 'success';
  entry.error = undefined;
  entry.updatedAt = Date.now();
  emit(entry);
}

export function getQueryData<T>(key: QueryKey): T | undefined {
  return cache.get(serializeKey(key))?.data as T | undefined;
}

/**
 * 讓快取失效。傳入前綴即可批次失效：
 *   invalidateQueries('workspace') 會清掉所有 workspace 開頭的 key。
 * 標記為 idle + updatedAt=0，掛載中的元件會由 effect 重新抓取。
 */
export function invalidateQueries(prefix: QueryKey): void {
  const p = serializeKey(prefix);
  for (const entry of cache.values()) {
    if (entry.key !== p && !entry.key.startsWith(p)) continue;
    entry.updatedAt = 0;
    entry.status = 'idle';
    entry.promise = null;
    if (entry.listeners.size === 0) {
      entry.data = undefined;
      entry.error = undefined;
    }
    emit(entry);
  }
}

/** 測試 / 登出時整個清空 */
export function clearQueryCache(): void {
  for (const entry of cache.values()) {
    entry.status = 'idle';
    entry.data = undefined;
    entry.error = undefined;
    entry.updatedAt = 0;
    entry.promise = null;
    emit(entry);
  }
  cache.clear();
}

/** 命令式操作（新增/刪除頁面…）的極簡包裝，處理 pending / error 狀態 */
export interface UseMutationResult<TArgs extends unknown[], TData> {
  mutate: (...args: TArgs) => Promise<TData>;
  isPending: boolean;
  error: unknown;
}

export function useMutation<TArgs extends unknown[], TData>(
  fn: (...args: TArgs) => Promise<TData>,
  opts: { invalidates?: QueryKey[]; onSuccess?: (data: TData) => void } = {},
): UseMutationResult<TArgs, TData> {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const mutate = useCallback(async (...args: TArgs) => {
    setPending(true);
    setError(undefined);
    try {
      const result = await fnRef.current(...args);
      for (const key of optsRef.current.invalidates ?? []) invalidateQueries(key);
      optsRef.current.onSuccess?.(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setPending(false);
    }
  }, []);

  return { mutate, isPending, error };
}
