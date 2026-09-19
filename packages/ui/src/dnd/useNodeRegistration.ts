import { useCallback, useEffect, useRef } from 'react';

/**
 * 「把節點登記給 DragController」的共用機制。
 *
 * ⚠️ 註冊不能只寫在 ref callback 裡：React 18 StrictMode 會把掛載 effect 跑
 * 「setup → cleanup → setup」，但**不會**重跑 ref callback。若註冊在 ref、反註冊在
 * effect cleanup，第二次 setup 前就已經把自己註銷掉了 —— 來源／落點區會靜靜消失。
 * 所以這裡以 effect 為準：ref callback 只記住節點，effect 負責註冊與反註冊。
 *
 * 另一個坑：呼叫端常常用 inline 的 ref callback（每次 render 都是新身分），
 * React 會在同一次 commit 裡先 `ref(null)` 再 `ref(同一個節點)`。
 * 立刻反註冊會在拖曳中把 zone 的 rect 快取清掉，所以 null 一律延到微任務再確認。
 *
 * @param register 註冊函式，回傳反註冊函式。內容（id/kind…）變了就靠 deps 觸發重註冊。
 * @param deps register 的相依（長度必須固定）。
 */
export function useNodeRegistration(
  register: (node: HTMLElement) => () => void,
  deps: readonly unknown[],
): (node: HTMLElement | null) => void {
  const nodeRef = useRef<HTMLElement | null>(null);
  const registeredRef = useRef<HTMLElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const activeRef = useRef(false);
  const pendingRef = useRef(false);
  const registerRef = useRef(register);
  registerRef.current = register;

  const sync = useCallback(() => {
    if (!activeRef.current) return;
    const node = nodeRef.current;
    if (registeredRef.current === node) return; // 同一個節點：不重註冊（避免清掉 rect 快取）
    cleanupRef.current?.();
    cleanupRef.current = null;
    registeredRef.current = null;
    if (!node) return;
    cleanupRef.current = registerRef.current(node);
    registeredRef.current = node;
  }, []);

  // 身分穩定（空相依），可以安心放進呼叫端的 deps。
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      nodeRef.current = node;
      if (!activeRef.current) return; // 還沒掛載：等 effect 來註冊
      if (node) {
        sync();
        return;
      }
      if (pendingRef.current) return;
      pendingRef.current = true;
      queueMicrotask(() => {
        pendingRef.current = false;
        sync();
      });
    },
    [sync],
  );

  useEffect(() => {
    activeRef.current = true;
    registeredRef.current = null; // deps 變了就強制重註冊
    sync();
    return () => {
      activeRef.current = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
      registeredRef.current = null;
    };
    // deps 由呼叫端決定（長度固定），所以展開進相依陣列。
  }, [sync, ...deps]);

  return setNodeRef;
}
