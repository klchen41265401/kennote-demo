import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../icons/Icon.js';
import { Popover } from './Popover.js';
import { MenuList } from './MenuList.js';
import { useMenuItem } from './MenuList.js';
import type { Placement } from '../positioning/index.js';
import formStyles from './Form.module.css';
import menuStyles from './Menu.module.css';
import { cx } from './cx.js';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  options: readonly SelectOption<V>[];
  value?: V | null;
  defaultValue?: V | null;
  onChange?: (value: V) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  /** 下拉寬度對齊觸發元素，預設 true。 */
  matchWidth?: boolean;
  placement?: Placement;
  'aria-label'?: string;
  className?: string;
  id?: string;
}

/**
 * 自建 listbox（不用原生 <select>，樣式不可控）。
 * role="listbox" + aria-activedescendant + 方向鍵 / Home / End / 首字母跳轉（§4.7.4）。
 */
export function Select<V extends string = string>({
  options,
  value: controlledValue,
  defaultValue = null,
  onChange,
  placeholder = '請選擇…',
  size = 'md',
  disabled = false,
  matchWidth = true,
  placement = 'bottom-start',
  className,
  id,
  ...aria
}: SelectProps<V>): JSX.Element {
  const [uncontrolled, setUncontrolled] = useState<V | null>(defaultValue);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolled;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const autoId = useId();

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  const choose = useCallback(
    (next: V) => {
      if (!isControlled) setUncontrolled(next);
      onChange?.(next);
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    },
    [isControlled, onChange],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id ?? autoId}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={aria['aria-label']}
        disabled={disabled}
        className={cx(
          formStyles['selectTrigger'],
          size === 'sm' && formStyles['selectTriggerSm'],
          className,
        )}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span
          className={cx(formStyles['selectValue'], !selected && formStyles['selectPlaceholder'])}
        >
          {selected?.label ?? placeholder}
        </span>
        <span className={formStyles['selectChevron']}>
          <Icon name="chevron-down" size={16} />
        </span>
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={() => triggerRef.current}
        placement={placement}
        matchWidth={matchWidth}
        offset={4}
        role="none"
        haspopup="listbox"
        padded={false}
        trapFocus
      >
        <MenuList role="listbox" onSelected={() => setOpen(false)}>
          {options.map((option) => (
            <SelectOptionRow
              key={option.value}
              option={option}
              selected={option.value === value}
              onSelect={() => choose(option.value)}
            />
          ))}
        </MenuList>
      </Popover>
    </>
  );
}

function SelectOptionRow<V extends string>({
  option,
  selected,
  onSelect,
}: {
  option: SelectOption<V>;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  const item = useMenuItem({
    disabled: option.disabled ?? false,
    text: option.label,
    onSelect,
  });
  return (
    <div
      ref={item.ref}
      role="option"
      tabIndex={item.isActive ? 0 : -1}
      aria-selected={selected}
      data-active={item.isActive || undefined}
      data-disabled={option.disabled || undefined}
      className={menuStyles['option']}
      onClick={() => !option.disabled && onSelect()}
      onPointerEnter={() => !option.disabled && item.ctx?.setActiveId(item.id)}
    >
      {option.icon ? <span className={menuStyles['itemIcon']}>{option.icon}</span> : null}
      <span className={menuStyles['itemBody']}>
        <span className={menuStyles['itemLabel']}>{option.label}</span>
        {option.description ? (
          <span className={menuStyles['itemDescription']}>{option.description}</span>
        ) : null}
      </span>
      {selected ? (
        <span className={menuStyles['itemCheck']}>
          <Icon name="check" size={16} />
        </span>
      ) : null}
    </div>
  );
}
