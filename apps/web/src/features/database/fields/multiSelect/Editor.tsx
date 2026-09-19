import type { EditorProps } from '../types';
import { OptionPicker } from '../_shared/parts';
import { idsOf } from '../_shared/ops';

export function Editor({ propertyId, value, def, onChange, onClose }: EditorProps) {
  return (
    <OptionPicker
      propertyId={propertyId}
      def={def}
      selected={idsOf(value)}
      multiple
      onChange={(ids) => onChange(ids)}
      onClose={onClose}
    />
  );
}
