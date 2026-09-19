import type { EditorProps } from '../types';
import { TextEditorInput } from '../_shared/parts';
import { numberOf } from '../_shared/ops';

export function Editor({ value, onChange, onClose, autoFocus }: EditorProps) {
  const current = numberOf(value);
  return (
    <TextEditorInput
      initial={current === null ? '' : String(current)}
      inputMode="numeric"
      autoFocus={autoFocus ?? true}
      onCommit={(next) => onChange(next.trim() === '' ? null : next)}
      onClose={onClose}
    />
  );
}
