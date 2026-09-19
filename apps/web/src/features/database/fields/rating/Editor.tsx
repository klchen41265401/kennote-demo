import type { EditorProps } from '../types';
import { StarRating } from '../_shared/parts';
import { numberOf } from '../_shared/ops';
import { ratingMax } from './ops';

export function Editor({ value, def, onChange }: EditorProps) {
  const config = def as { max?: number; icon?: 'star' | 'heart' | 'number' };
  return (
    <StarRating
      value={numberOf(value) ?? 0}
      max={ratingMax(config)}
      icon={config.icon ?? 'star'}
      onChange={(next) => onChange(next === 0 ? null : next)}
    />
  );
}
