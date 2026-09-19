import type { EditorProps } from '../types';
import { DateEditor } from '../_shared/parts';

export function Editor({ value, onChange, onClose }: EditorProps) {
  const date = value && value.type === 'date' ? value : null;
  return (
    <DateEditor
      start={date?.start ?? null}
      end={date?.end ?? null}
      includeTime={date?.includeTime ?? false}
      onChange={(next) => onChange(next)}
      onClose={onClose}
    />
  );
}
