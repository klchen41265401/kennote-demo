import type { CellProps } from '../types';
import { StarRating } from '../_shared/parts';
import { numberOf } from '../_shared/ops';
import { ratingMax } from './ops';

export function Cell({ value, def }: CellProps) {
  const config = def as { max?: number; icon?: 'star' | 'heart' | 'number' };
  return (
    <StarRating
      value={numberOf(value) ?? 0}
      max={ratingMax(config)}
      icon={config.icon ?? 'star'}
    />
  );
}
