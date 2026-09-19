import { useState, type HTMLAttributes, type ReactNode } from 'react';
import styles from './Display.module.css';
import { cx } from './cx.js';

/** 依 userId 雜湊配色，同一個人永遠同一個顏色。 */
const PALETTE = [
  'var(--kn-color-block-gray, #787774)',
  'var(--kn-color-block-brown, #976d57)',
  'var(--kn-color-block-orange, #cc772f)',
  'var(--kn-color-block-yellow, #c29343)',
  'var(--kn-color-block-green, #548164)',
  'var(--kn-color-block-blue, #477da5)',
  'var(--kn-color-block-purple, #8a67ab)',
  'var(--kn-color-block-pink, #b35488)',
  'var(--kn-color-block-red, #c4554d)',
];

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length] as string;
}

/** 取姓名首字：中文取第一個字，英文取首字母（最多兩個）。 */
export function avatarInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  if (/[㐀-鿿]/.test(trimmed)) return trimmed.slice(-2);
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return (words[0] as string).slice(0, 2).toUpperCase();
  return `${(words[0] as string)[0]}${(words[words.length - 1] as string)[0]}`.toUpperCase();
}

export interface AvatarProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  name: string;
  src?: string | null;
  /** 配色種子；沒給就用 name。 */
  seed?: string;
  size?: number;
  shape?: 'circle' | 'rounded';
}

/** 圖片失敗時 fallback 為姓名首字 + 依 id 雜湊配色（§4.7.4）。 */
export function Avatar({
  name,
  src,
  seed,
  size = 24,
  shape = 'circle',
  className,
  style,
  ...rest
}: AvatarProps): JSX.Element {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  return (
    <span
      className={cx(
        styles['avatar'],
        shape === 'circle' ? styles['avatarCircle'] : styles['avatarRounded'],
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.42)),
        background: showImage ? 'transparent' : avatarColor(seed ?? name),
        ...style,
      }}
      title={name}
      {...rest}
    >
      {showImage ? (
        <img
          className={styles['avatarImg']}
          src={src as string}
          alt={name}
          onError={() => setFailed(true)}
        />
      ) : (
        avatarInitials(name)
      )}
    </span>
  );
}

export interface AvatarStackProps extends HTMLAttributes<HTMLSpanElement> {
  /** 最多顯示幾個，其餘收成 +N。 */
  max?: number;
  size?: number;
  children?: ReactNode;
  people: ReadonlyArray<{ id?: string; name: string; src?: string | null }>;
}

export function AvatarStack({
  people,
  max = 4,
  size = 24,
  className,
  ...rest
}: AvatarStackProps): JSX.Element {
  const shown = people.slice(0, max);
  const restCount = people.length - shown.length;
  return (
    <span className={cx(styles['avatarStack'], className)} {...rest}>
      {shown.map((p, i) => (
        <Avatar key={p.id ?? `${p.name}-${i}`} name={p.name} src={p.src} seed={p.id} size={size} />
      ))}
      {restCount > 0 ? <Avatar name={`+${restCount}`} seed="overflow" size={size} /> : null}
    </span>
  );
}
