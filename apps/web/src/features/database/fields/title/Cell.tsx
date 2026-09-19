import type { CellProps } from '../types';
import { PlainCell } from '../_shared/parts';
import { plainTextOf } from '../_shared/ops';

export function Cell({ value }: CellProps) {
  return <PlainCell text={plainTextOf(value)} />;
}
