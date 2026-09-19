import type { CellProps } from '../types';
import { PlainCell } from '../_shared/parts';
import { computedValueOf } from '../_shared/ops';
import styles from '../_shared/fields.module.css';

export function Cell({ value }: CellProps) {
  const error = (value as { error?: string } | undefined)?.error;
  if (error) {
    return (
      <span className={styles.computedError} title={error}>
        計算錯誤
      </span>
    );
  }
  const v = computedValueOf(value);
  if (typeof v === 'boolean') return <PlainCell text={v ? '是' : '否'} />;
  return <PlainCell text={v === null ? '' : String(v)} />;
}
