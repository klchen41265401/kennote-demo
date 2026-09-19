import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import styles from './Display.module.css';
import { cx } from './cx.js';

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  content?: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  /** 右側額外內容（例如「＋ 新增檢視」）。 */
  actions?: ReactNode;
  /** 只渲染 tab list，內容自行處理。 */
  hideContent?: boolean;
  className?: string;
  'aria-label'?: string;
}

/** role="tablist" + roving tabindex + ←→/Home/End。 */
export function Tabs({
  items,
  value: controlledValue,
  defaultValue,
  onChange,
  actions,
  hideContent = false,
  className,
  ...aria
}: TabsProps): JSX.Element {
  const first = items[0]?.id ?? '';
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? first);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolled;
  const baseId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);

  const select = useCallback(
    (id: string) => {
      if (!isControlled) setUncontrolled(id);
      onChange?.(id);
    },
    [isControlled, onChange],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const usable = items.filter((t) => !t.disabled);
      if (usable.length === 0) return;
      const current = usable.findIndex((t) => t.id === value);
      let nextIndex: number | null = null;
      if (e.key === 'ArrowRight') nextIndex = (current + 1) % usable.length;
      else if (e.key === 'ArrowLeft') nextIndex = (current - 1 + usable.length) % usable.length;
      else if (e.key === 'Home') nextIndex = 0;
      else if (e.key === 'End') nextIndex = usable.length - 1;
      if (nextIndex === null) return;
      e.preventDefault();
      const target = usable[nextIndex];
      if (!target) return;
      select(target.id);
      listRef.current
        ?.querySelectorAll<HTMLElement>('[role="tab"]')
        .forEach((node) => {
          if (node.dataset['tabId'] === target.id) node.focus({ preventScroll: true });
        });
    },
    [items, value, select],
  );

  const active = items.find((t) => t.id === value) ?? null;

  return (
    <div className={cx(styles['tabs'], className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={aria['aria-label']}
        className={styles['tabList']}
        onKeyDown={onKeyDown}
      >
        {items.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab-id={tab.id}
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={tab.id === value}
            aria-controls={`${baseId}-panel-${tab.id}`}
            tabIndex={tab.id === value ? 0 : -1}
            disabled={tab.disabled}
            className={styles['tab']}
            onClick={() => select(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        {actions}
      </div>
      {!hideContent && active ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.id}`}
          aria-labelledby={`${baseId}-tab-${active.id}`}
          tabIndex={0}
          className={styles['tabPanel']}
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}
