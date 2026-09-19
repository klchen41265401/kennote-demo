/**
 * 最小 Toast（02 §4.4.1）。右下角堆疊、4s 自動關閉、不搶焦點。
 *
 * `packages/ui` 的 Toast 尚未 export；等它 export 之後，
 * 把 `toast()` 改成轉呼叫即可（見 README「決策」）。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'info' | 'error' | 'success';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; run(): void };
}

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function publish(): void {
  const snapshot = items;
  for (const cb of [...listeners]) cb(snapshot);
}

export function toast(
  message: string,
  options: { kind?: ToastKind; durationMs?: number; action?: ToastItem['action'] } = {},
): () => void {
  const id = nextId++;
  const item: ToastItem = { id, kind: options.kind ?? 'info', message };
  if (options.action) item.action = options.action;
  items = [...items, item];
  publish();
  const dismiss = (): void => {
    items = items.filter((t) => t.id !== id);
    publish();
  };
  const timer = setTimeout(dismiss, options.durationMs ?? 4000);
  return () => {
    clearTimeout(timer);
    dismiss();
  };
}

export function useToasts(): ToastItem[] {
  const [state, setState] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setState);
    setState(items);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return state;
}

export function ToastHost() {
  const toasts = useToasts();
  if (typeof document === 'undefined' || toasts.length === 0) return null;
  return createPortal(
    <div className="kn-toast-host" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="kn-toast" data-kind={t.kind}>
          <span className="kn-toast-message">{t.message}</span>
          {t.action ? (
            <button type="button" className="kn-toast-action" onClick={t.action.run}>
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** 測試用 */
export function __resetToasts(): void {
  items = [];
  publish();
}
