import type { SelectOption } from '@kennote/shared-types';
import type { CellProps } from '../types';
import { ChipRow } from '../_shared/parts';
import { idsOf, optionOf } from '../_shared/ops';

export function Cell({ value, def, compact }: CellProps) {
  const options = idsOf(value)
    .map((id) => optionOf(def, id))
    .filter((o): o is SelectOption => Boolean(o));
  return <ChipRow options={options} max={compact ? 2 : 4} />;
}
