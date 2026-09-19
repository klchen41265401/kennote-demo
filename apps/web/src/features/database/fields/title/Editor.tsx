import type { EditorProps } from '../types';
import { TextEditorInput } from '../_shared/parts';
import { plainTextOf } from '../_shared/ops';

export function Editor({ value, onChange, onClose, autoFocus }: EditorProps) {
  return (
    <TextEditorInput
      initial={plainTextOf(value)}
      multiline={false}
      autoFocus={autoFocus ?? true}
      onCommit={(next) => onChange(next)}
      onClose={onClose}
    />
  );
}
