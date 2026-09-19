import type { EditorProps } from '../types';
import { PersonPicker } from '../_shared/parts';
import { idsOf } from '../_shared/ops';

export function Editor({ value, def, onChange, onClose }: EditorProps) {
  const allowMultiple = (def as { allowMultiple?: boolean }).allowMultiple ?? true;
  return (
    <PersonPicker
      selected={idsOf(value)}
      multiple={allowMultiple}
      onChange={(ids) => onChange(ids)}
      onClose={onClose}
    />
  );
}
