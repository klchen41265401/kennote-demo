import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { OverlayPortal } from '../overlay/OverlayRoot.js';
import { OVERLAY_Z_INDEX } from '../overlay/stack.js';
import { Icon, type IconName } from '../icons/index.js';
import { Button } from './Button.js';
import { IconButton } from './IconButton.js';
import styles from './Toast.module.css';
import { cx } from './cx.js';

export type ToastTone = 'info' | 'success' | 'error' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** 毫秒；0 表示不自動關閉。預設 4000。 */
  duration?: number;
  /** 例如「復原」。 */
  action?: ToastAction;
  /** 相同 id 會取代既有的 toast（避免洗版）。 */
  id?: string;
  onDismiss?: () => void;
}

export interface ToastRecord extends ToastOptions {
  id: string;
  tone: ToastTone;
  duration: number;
  createdAt: number;
}

/** 同時最多 3 則（§4.7.4）。 */
const MAX_TOASTS = 3;
const DEFAULT_DURATION = 4000;

type Listener = () => void;

class ToastStore {
  private items: ToastRecord[] = [];
  private snapshot: readonly ToastRecord[] = [];
  private listeners = new Set<Listener>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private seq = 0;

  show = (options: ToastOptions): string => {
    const id = options.id ?? `toast-${++this.seq}`;
    const record: ToastRecord = {
      ...options,
      id,
      tone: options.tone ?? 'info',
      duration: options.duration ?? DEFAULT_DURATION,
      createdAt: Date.now(),
    };
    const existing = this.items.findIndex((t) => t.id === id);
    if (existing !== -1) this.items.splice(existing, 1, record);
    else this.items.push(record);
    // 超過上限時丟掉最舊的。
    while (this.items.length > MAX_TOASTS) {
      const dropped = this.items.shift();
      if (dropped) this.clearTimer(dropped.id);
    }
    this.scheduleDismiss(record);
    this.notify();
    return id;
  };

  success = (title: ReactNode, options: Omit<ToastOptions, 'title' | 'tone'> = {}): string =>
    this.show({ ...options, title, tone: 'success' });

  error = (title: ReactNode, options: Omit<ToastOptions, 'title' | 'tone'> = {}): string =>
    this.show({ ...options, title, tone: 'error', duration: options.duration ?? 6000 });

  warning = (title: ReactNode, options: Omit<ToastOptions, 'title' | 'tone'> = {}): string =>
    this.show({ ...options, title, tone: 'warning' });

  dismiss = (id: string): void => {
    const idx = this.items.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [removed] = this.items.splice(idx, 1);
    this.clearTimer(id);
    removed?.onDismiss?.();
    this.notify();
  };

  clear = (): void => {
    for (const t of this.items) this.clearTimer(t.id);
    this.items = [];
    this.notify();
  };

  /** 滑鼠移入時暫停倒數。 */
  pause = (id: string): void => this.clearTimer(id);

  resume = (id: string): void => {
    const record = this.items.find((t) => t.id === id);
    if (record) this.scheduleDismiss(record);
  };

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): readonly ToastRecord[] => this.snapshot;

  private scheduleDismiss(record: ToastRecord): void {
    this.clearTimer(record.id);
    if (record.duration <= 0) return;
    this.timers.set(
      record.id,
      setTimeout(() => this.dismiss(record.id), record.duration),
    );
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  private notify(): void {
    this.snapshot = [...this.items];
    for (const fn of this.listeners) fn();
  }
}

/** 全域 toast API：`toast.show({ title: '已刪除', action: { label: '復原', onClick } })` */
export const toast: ToastStore = new ToastStore();

export function useToasts(): readonly ToastRecord[] {
  return useSyncExternalStore(toast.subscribe, toast.getSnapshot, toast.getSnapshot);
}

const TONE_ICON: Record<ToastTone, IconName> = {
  info: 'help',
  success: 'check',
  error: 'close',
  warning: 'bell',
};

export interface ToastRegionProps {
  className?: string;
}

/** 掛在 App 最外層一次。Toast 不搶焦點，用 aria-live 播報。 */
export function ToastRegion({ className }: ToastRegionProps): JSX.Element {
  const toasts = useToasts();
  return (
    <OverlayPortal>
      <div
        className={cx(styles['region'], 'kn-toast-region', className)}
        style={{ zIndex: OVERLAY_Z_INDEX.toast }}
        role="region"
        aria-label="通知"
      >
        {toasts.map((item) => (
          <ToastItem key={item.id} toast={item} />
        ))}
      </div>
    </OverlayPortal>
  );
}

function ToastItem({ toast: item }: { toast: ToastRecord }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => toast.pause(item.id), [item.id]);
  return (
    <div
      ref={ref}
      className={cx(styles['toast'], styles[item.tone])}
      role={item.tone === 'error' ? 'alert' : 'status'}
      aria-live={item.tone === 'error' ? 'assertive' : 'polite'}
      onPointerEnter={() => toast.pause(item.id)}
      onPointerLeave={() => toast.resume(item.id)}
    >
      <span className={styles['icon']}>
        <Icon name={TONE_ICON[item.tone]} size={16} />
      </span>
      <div className={styles['content']}>
        <span className={styles['title']}>{item.title}</span>
        {item.description ? <span className={styles['description']}>{item.description}</span> : null}
      </div>
      <div className={styles['actions']}>
        {item.action ? (
          <Button
            size="sm"
            variant="subtle"
            onClick={() => {
              item.action?.onClick();
              toast.dismiss(item.id);
            }}
          >
            {item.action.label}
          </Button>
        ) : null}
        <IconButton label="關閉" size="sm" tooltip={false} onClick={() => toast.dismiss(item.id)}>
          <Icon name="close" size={14} />
        </IconButton>
      </div>
    </div>
  );
}
