/**
 * 篩選條件的值編輯器。每種欄位型別在 registry 裡指定要用哪一個，
 * FilterBuilder 完全不知道有哪些型別存在（04 §10.2 的目的）。
 */
import type { DateFilterValue, SelectOption } from '@kennote/shared-types';
import { RELATIVE_DATES, RELATIVE_DATE_LABELS } from '@kennote/shared-types';
import { useDatabaseContext } from '../../context';
import type { FilterInputProps } from '../types';
import styles from './fields.module.css';
import { optionList } from './ops';

export function NoFilterInput() {
  return <span className={styles.filterNoValue}>—</span>;
}

export function TextFilterInput({ value, onChange }: FilterInputProps) {
  return (
    <input
      className={styles.filterInput}
      value={typeof value === 'string' ? value : ''}
      placeholder="輸入值"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function NumberFilterInput({ value, onChange }: FilterInputProps) {
  return (
    <input
      className={styles.filterInput}
      type="number"
      value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
      placeholder="輸入數字"
      onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
    />
  );
}

function OptionSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: SelectOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <select className={styles.filterInput} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.value}
        </option>
      ))}
    </select>
  );
}

export function SelectFilterInput({ operator, value, def, onChange }: FilterInputProps) {
  const options = optionList(def);
  if (operator === 'isAnyOf' || operator === 'isNoneOf') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className={styles.filterChips}>
        {options.map((o) => {
          const on = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              className={on ? styles.filterChipOn : styles.filterChip}
              onClick={() => onChange(on ? selected.filter((v) => v !== o.id) : [...selected, o.id])}
            >
              {o.value}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <OptionSelect
      options={options}
      value={typeof value === 'string' ? value : ''}
      onChange={onChange}
      placeholder="選擇選項"
    />
  );
}

export function CheckboxFilterInput({ value, onChange }: FilterInputProps) {
  return (
    <select
      className={styles.filterInput}
      value={value === true || value === 'true' ? 'true' : 'false'}
      onChange={(e) => onChange(e.target.value === 'true')}
    >
      <option value="true">已勾選</option>
      <option value="false">未勾選</option>
    </select>
  );
}

export function PersonFilterInput({ value, onChange }: FilterInputProps) {
  const { members } = useDatabaseContext();
  return (
    <select
      className={styles.filterInput}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">選擇成員</option>
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.user.name}
        </option>
      ))}
    </select>
  );
}

/**
 * 日期的值有三種形式（03 §6.5）：絕對、相對（今天/本週…）、相對 N 天。
 * 相對值存下來、查詢時才展開，「今天到期」每天才會是對的。
 */
export function DateFilterInput({ value, onChange }: FilterInputProps) {
  const current = (value ?? { kind: 'relative', relative: 'today' }) as DateFilterValue;
  const kind = current.kind ?? 'relative';

  return (
    <div className={styles.filterDate}>
      <select
        className={styles.filterInput}
        value={kind === 'exact' ? 'exact' : ((current as { relative?: string }).relative ?? 'today')}
        onChange={(e) => {
          if (e.target.value === 'exact') {
            onChange({ kind: 'exact', start: new Date().toISOString().slice(0, 10) });
          } else {
            onChange({ kind: 'relative', relative: e.target.value });
          }
        }}
      >
        {RELATIVE_DATES.map((r) => (
          <option key={r} value={r}>
            {RELATIVE_DATE_LABELS[r]}
          </option>
        ))}
        <option value="exact">指定日期…</option>
      </select>
      {kind === 'exact' ? (
        <input
          className={styles.filterInput}
          type="date"
          value={(current as { start?: string }).start ?? ''}
          onChange={(e) => onChange({ kind: 'exact', start: e.target.value })}
        />
      ) : null}
    </div>
  );
}
