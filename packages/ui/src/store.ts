/**
 * 自研輕量 store（04 §7.2 / 02 §5）。
 * 不用 zustand / redux —— check-deps.ts 的黑名單把這條紀律變成 CI 檢查。
 *
 * 設計要點：
 * - `getState()` 回傳的參考在 state 沒變時必須穩定，否則 useSyncExternalStore 會無限重繪。
 * - `setState` 接受「新值」或「(prev) => 新值」，回傳 false 代表不變更（跳過通知）。
 */
import { useCallback, useDebugValue, useSyncExternalStore } from 'react';

export type Listener = () => void;
export type Updater<T> = T | ((prev: T) => T);

export interface Store<T> {
  getState(): T;
  setState(next: Updater<T>): void;
  subscribe(listener: Listener): () => void;
  /** 測試用：重設回初始值 */
  reset(): void;
}

export function createStore<T>(initialState: T): Store<T> {
  let state = initialState;
  const listeners = new Set<Listener>();

  const notify = () => {
    // 複製一份再迭代：listener 內部可能會 unsubscribe
    for (const l of [...listeners]) l();
  };

  return {
    getState: () => state,
    setState(next) {
      const value =
        typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      state = initialState;
      notify();
    },
  };
}

const identity = <T,>(s: T): unknown => s;

/**
 * 訂閱 store。selector 每次 render 都會重算，
 * 因此**不要在 selector 內建立新物件**（會讓下游 memo 失效，但不會造成無限迴圈）。
 */
export function useStore<T>(store: Store<T>): T;
export function useStore<T, S>(store: Store<T>, selector: (state: T) => S): S;
export function useStore<T, S>(store: Store<T>, selector?: (state: T) => S): S | T {
  const subscribe = useCallback((l: Listener) => store.subscribe(l), [store]);
  const state = useSyncExternalStore(subscribe, store.getState, store.getState);
  const selected = (selector ?? (identity as (state: T) => S))(state);
  useDebugValue(selected);
  return selected;
}

/** 常見的「物件 state 局部更新」輔助 */
export function patchStore<T extends object>(store: Store<T>, patch: Partial<T>): void {
  store.setState((prev) => ({ ...prev, ...patch }));
}
