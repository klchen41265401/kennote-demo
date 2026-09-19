/**
 * 各欄位型別共用的顯示與編輯元件。
 *
 * 02 §3.5 的架構要點：CellEditor、頁面屬性列（RowPeek）、篩選條件的值編輯器
 * **共用同一組型別編輯器元件**。三處各寫一份的話，日後新增欄位型別要改三個地方。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldDefinition, SelectColor, SelectOption } from '@kennote/shared-types';
import { useDatabaseContext } from '../../context';
import { UiIcon } from '../../_fallback';
import styles from './fields.module.css';
import { optionList } from './ops';

/* ── 顯示 ─────────────────────────────────────────────── */

export function Chip({ label, color }: { label: string; color?: SelectColor }) {
  return (
    <span className={styles.chip} data-color={color ?? 'default'}>
      {label}
    </span>
  );
}

export function ChipRow({ options, max = 4 }: { options: SelectOption[]; max?: number }) {
  if (options.length === 0) return null;
  const shown = options.slice(0, max);
  const rest = options.length - shown.length;
  return (
    <span className={styles.chipRow}>
      {shown.map((o) => (
        <Chip key={o.id} label={o.value} color={o.color} />
      ))}
      {rest > 0 ? <span className={styles.chipMore}>+{rest}</span> : null}
    </span>
  );
}

export function PlainCell({
  text,
  align,
  muted,
  title,
}: {
  text: string;
  align?: 'left' | 'right';
  muted?: boolean;
  title?: string;
}) {
  if (text === '') return <span className={styles.empty} />;
  return (
    <span
      className={muted ? styles.plainMuted : styles.plain}
      style={align === 'right' ? { textAlign: 'right', width: '100%' } : undefined}
      title={title ?? text}
    >
      {text}
    </span>
  );
}

/* ── 編輯 ─────────────────────────────────────────────── */

interface TextEditorInputProps {
  initial: string;
  multiline?: boolean;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'email' | 'tel' | 'url';
  onCommit: (value: string) => void;
  onClose: () => void;
  autoFocus?: boolean;
}

/**
 * 就地輸入：Enter / 失焦送出，Escape 取消。
 * 刻意不做「每次按鍵都送 API」—— 那會在多人協作時產生大量無意義的 operation。
 *
 * 多行欄位（text）照 Notion：**Enter 送出**、Shift+Enter 才換行。
 * 原本是反過來的（Enter 換行、Ctrl/Cmd+Enter 才送出），結果使用者打完字按 Enter
 * 只會塞一個 `
` 進去、編輯器還賴著不關，存下來的值變成 `hello
`。
 */
export function TextEditorInput({
  initial,
  multiline,
  placeholder,
  inputMode = 'text',
  onCommit,
  onClose,
  autoFocus = true,
}: TextEditorInputProps) {
  const [value, setValue] = useState(initial);
  const cancelled = useRef(false);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange?.(el.value.length, el.value.length);
  }, [autoFocus]);

  function commitAndClose() {
    if (cancelled.current) return;
    if (value !== initial) onCommit(value);
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelled.current = true;
      onClose();
      return;
    }
    if (e.key === 'Enter' && (!multiline || !e.shiftKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitAndClose();
    }
  }

  const shared = {
    className: styles.editorInput,
    value,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValue(e.target.value),
    onKeyDown,
    onBlur: commitAndClose,
    'data-autofocus': true,
  };

  return multiline ? (
    <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} rows={3} {...shared} />
  ) : (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      type="text"
      inputMode={inputMode}
      {...shared}
    />
  );
}

interface OptionPickerProps {
  propertyId: string;
  def: FieldDefinition;
  selected: string[];
  multiple: boolean;
  onChange: (optionIds: string[]) => void;
  onClose: () => void;
}

/** select / multiSelect 的下拉：搜尋 + 勾選 + 就地建立新選項 */
export function OptionPicker({
  propertyId,
  def,
  selected,
  multiple,
  onChange,
  onClose,
}: OptionPickerProps) {
  const { createOption } = useDatabaseContext();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const options = optionList(def);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle === '' ? options : options.filter((o) => o.value.toLowerCase().includes(needle));
  }, [options, search]);

  const exact = options.some((o) => o.value === search.trim());

  function toggle(id: string) {
    if (!multiple) {
      onChange(selected.includes(id) ? [] : [id]);
      onClose();
      return;
    }
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  }

  async function create() {
    const label = search.trim();
    if (label === '' || creating) return;
    setCreating(true);
    try {
      const id = await createOption(propertyId, label);
      if (id) {
        onChange(multiple ? [...selected, id] : [id]);
        setSearch('');
        if (!multiple) onClose();
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.picker}>
      <input
        className={styles.pickerSearch}
        value={search}
        placeholder="搜尋或建立選項"
        autoFocus
        data-autofocus
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const first = filtered[0];
            if (first) toggle(first.id);
            else void create();
          }
        }}
      />
      <div className={styles.pickerList} role="listbox">
        {filtered.map((option) => (
          <button
            key={option.id}
            type="button"
            role="option"
            aria-selected={selected.includes(option.id)}
            className={styles.pickerItem}
            onClick={() => toggle(option.id)}
          >
            <Chip label={option.value} color={option.color} />
            {selected.includes(option.id) ? <UiIcon name="check" size={14} /> : null}
          </button>
        ))}
        {search.trim() !== '' && !exact ? (
          <button type="button" className={styles.pickerCreate} onClick={() => void create()}>
            <UiIcon name="plus" size={14} />
            建立「{search.trim()}」
          </button>
        ) : null}
        {filtered.length === 0 && search.trim() === '' ? (
          <p className={styles.pickerEmpty}>這個欄位還沒有選項</p>
        ) : null}
      </div>
    </div>
  );
}

interface PersonPickerProps {
  selected: string[];
  multiple: boolean;
  onChange: (userIds: string[]) => void;
  onClose: () => void;
}

export function PersonPicker({ selected, multiple, onChange, onClose }: PersonPickerProps) {
  const { members } = useDatabaseContext();
  const [search, setSearch] = useState('');
  const filtered = members.filter((m) =>
    m.user.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  function toggle(userId: string) {
    if (!multiple) {
      onChange(selected.includes(userId) ? [] : [userId]);
      onClose();
      return;
    }
    onChange(
      selected.includes(userId) ? selected.filter((v) => v !== userId) : [...selected, userId],
    );
  }

  return (
    <div className={styles.picker}>
      <input
        className={styles.pickerSearch}
        value={search}
        placeholder="搜尋成員"
        autoFocus
        data-autofocus
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <div className={styles.pickerList} role="listbox">
        {filtered.map((member) => (
          <button
            key={member.userId}
            type="button"
            role="option"
            aria-selected={selected.includes(member.userId)}
            className={styles.pickerItem}
            onClick={() => toggle(member.userId)}
          >
            <Avatar name={member.user.name} url={member.user.avatarUrl} />
            <span className={styles.pickerItemLabel}>{member.user.name}</span>
            {selected.includes(member.userId) ? <UiIcon name="check" size={14} /> : null}
          </button>
        ))}
        {filtered.length === 0 ? <p className={styles.pickerEmpty}>找不到成員</p> : null}
      </div>
    </div>
  );
}

export function Avatar({ name, url }: { name: string; url?: string | null }) {
  if (url) return <img className={styles.avatar} src={url} alt="" />;
  return (
    <span className={styles.avatarFallback} aria-hidden="true">
      {[...name][0] ?? '?'}
    </span>
  );
}

interface DateEditorProps {
  start: string | null;
  end: string | null;
  includeTime: boolean;
  onChange: (value: { start: string; end: string | null; includeTime: boolean } | null) => void;
  onClose: () => void;
}

export function DateEditor({ start, end, includeTime, onChange, onClose }: DateEditorProps) {
  const [range, setRange] = useState(Boolean(end));

  function update(patch: { start?: string; end?: string | null; includeTime?: boolean }) {
    const nextStart = patch.start ?? start ?? '';
    if (nextStart === '') {
      onChange(null);
      return;
    }
    onChange({
      start: nextStart,
      end: patch.end !== undefined ? patch.end : (end ?? null),
      includeTime: patch.includeTime ?? includeTime,
    });
  }

  return (
    <div className={styles.datePicker} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <label className={styles.dateRow}>
        <span>開始</span>
        <input
          type={includeTime ? 'datetime-local' : 'date'}
          value={includeTime ? (start ?? '').slice(0, 16) : (start ?? '').slice(0, 10)}
          autoFocus
          data-autofocus
          onChange={(e) => update({ start: e.target.value })}
        />
      </label>
      {range ? (
        <label className={styles.dateRow}>
          <span>結束</span>
          <input
            type={includeTime ? 'datetime-local' : 'date'}
            value={includeTime ? (end ?? '').slice(0, 16) : (end ?? '').slice(0, 10)}
            onChange={(e) => update({ end: e.target.value || null })}
          />
        </label>
      ) : null}
      <label className={styles.dateToggle}>
        <input
          type="checkbox"
          checked={range}
          onChange={(e) => {
            setRange(e.target.checked);
            if (!e.target.checked) update({ end: null });
          }}
        />
        結束日期
      </label>
      <label className={styles.dateToggle}>
        <input
          type="checkbox"
          checked={includeTime}
          onChange={(e) => update({ includeTime: e.target.checked })}
        />
        包含時間
      </label>
      <button type="button" className={styles.dateClear} onClick={() => onChange(null)}>
        清除
      </button>
    </div>
  );
}

export function StarRating({
  value,
  max,
  icon,
  onChange,
}: {
  value: number;
  max: number;
  icon: 'star' | 'heart' | 'number';
  onChange?: (next: number) => void;
}) {
  if (icon === 'number') {
    return <PlainCell text={value > 0 ? `${value}/${max}` : ''} />;
  }
  const glyph = icon === 'heart' ? '♥' : '★';
  return (
    <span className={styles.rating} role={onChange ? 'group' : undefined}>
      {Array.from({ length: max }, (_, i) => {
        const filled = i < value;
        const label = `${i + 1} 分`;
        return onChange ? (
          <button
            key={i}
            type="button"
            className={filled ? styles.ratingOn : styles.ratingOff}
            aria-label={label}
            onClick={(e) => {
              e.stopPropagation();
              onChange(filled && value === i + 1 ? 0 : i + 1);
            }}
          >
            {glyph}
          </button>
        ) : (
          <span key={i} className={filled ? styles.ratingOn : styles.ratingOff} aria-hidden="true">
            {glyph}
          </span>
        );
      })}
    </span>
  );
}
