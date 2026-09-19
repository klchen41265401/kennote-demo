import type { CellProps } from '../types';
import { PlainCell } from '../_shared/parts';
import { formatNumber, numberOf } from '../_shared/ops';

export function Cell({ value, def }: CellProps) {
  // 數字靠右對齊（Notion 的行為），一欄數字才掃得快
  return <PlainCell text={formatNumber(numberOf(value), def)} align="right" />;
}
