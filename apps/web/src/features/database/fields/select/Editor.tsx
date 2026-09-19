import type { EditorProps } from '../types';
import { OptionPicker } from '../_shared/parts';

export function Editor({ propertyId, value, def, onChange, onClose }: EditorProps) {
  const selected = value && value.type === 'select' && value.optionId ? [value.optionId] : [];
  return (
    <OptionPicker
      propertyId={propertyId}
      def={def}
      selected={selected}
      multiple={false}
      onChange={(ids) => onChange(ids[0] ?? null)}
      onClose={onClose}
    />
  );
}
