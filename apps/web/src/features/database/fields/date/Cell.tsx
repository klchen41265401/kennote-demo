import type { CellProps } from '../types';
import { PlainCell } from '../_shared/parts';
import { ops } from './ops';

export function Cell({ value, def }: CellProps) {
  return <PlainCell text={ops.toPlainText(value, def)} />;
}
