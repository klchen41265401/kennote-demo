import type { CellProps } from '../types';
import { PlainCell } from '../_shared/parts';
import { dateStartOf, formatDateValue } from '../_shared/ops';

export function Cell({ value, def }: CellProps) {
  return <PlainCell text={formatDateValue(dateStartOf(value), def)} muted />;
}
