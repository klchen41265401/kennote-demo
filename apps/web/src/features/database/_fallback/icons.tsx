/**
 * 圖示。`packages/ui` 的 icons 補齊之後，這裡換成 re-export 即可。
 *
 * 欄位型別的圖示刻意用字形（Aa / # / ▾ …）而不是 SVG：
 * 它們本來就是「符號」而不是插畫，用字形可讀性一樣、體積小得多，
 * 而且跟著 currentColor 與字級走，不必為深色主題另做一套。
 */
import type { CSSProperties } from 'react';

const FIELD_GLYPHS: Record<string, string> = {
  title: 'Aa',
  text: 'Aa',
  number: '#',
  select: '▾',
  multiSelect: '≡',
  date: '▤',
  person: '☺',
  files: '❑',
  checkbox: '☑',
  url: '🔗',
  email: '@',
  phone: '☏',
  rating: '★',
  formula: 'ƒ',
  relation: '↗',
  rollup: 'Σ',
  createdTime: '⏲',
  lastEditedTime: '⏱',
  createdBy: '✎',
  lastEditedBy: '✐',
};

export function FieldIcon({ type, className }: { type: string; className?: string }) {
  return (
    <span className={className} aria-hidden="true" style={glyphStyle}>
      {FIELD_GLYPHS[type] ?? '·'}
    </span>
  );
}

const glyphStyle: CSSProperties = {
  display: 'inline-flex',
  width: 16,
  justifyContent: 'center',
  fontSize: 12,
  lineHeight: 1,
  color: 'var(--kn-color-text-tertiary)',
  flex: '0 0 auto',
};

export type UiIconName =
  | 'chevronDown'
  | 'chevronRight'
  | 'plus'
  | 'close'
  | 'search'
  | 'filter'
  | 'sort'
  | 'more'
  | 'drag'
  | 'expand'
  | 'check'
  | 'group'
  | 'eye'
  | 'eyeOff'
  | 'download';

const PATHS: Record<UiIconName, string> = {
  chevronDown: 'M3.5 6 8 10.5 12.5 6',
  chevronRight: 'M6 3.5 10.5 8 6 12.5',
  plus: 'M8 3.5v9M3.5 8h9',
  close: 'M4 4l8 8M12 4l-8 8',
  search: 'M11.5 11.5 14 14M7 12a5 5 0 100-10 5 5 0 000 10z',
  filter: 'M2.5 4h11M4.5 8h7M6.5 12h3',
  sort: 'M4 5h8M4 8h5M4 11h3M12.5 9.5l-1.5 2-1.5-2',
  more: 'M4 8h.01M8 8h.01M12 8h.01',
  drag: 'M6 4h.01M6 8h.01M6 12h.01M10 4h.01M10 8h.01M10 12h.01',
  expand: 'M6 3.5H3.5V6M10 12.5h2.5V10M3.5 10v2.5H6M12.5 6V3.5H10',
  check: 'M3.5 8.5 6.5 11.5 12.5 5',
  group: 'M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 100-4 2 2 0 000 4z',
  eyeOff: 'M3 3l10 10M6.5 6.6A2 2 0 008 10a2 2 0 001.4-.6M4 5.3C2.5 6.5 1.5 8 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.7-.7',
  download: 'M8 3v7M5 7.5 8 10.5l3-3M3.5 12.5h9',
};

export function UiIcon({
  name,
  size = 16,
  className,
}: {
  name: UiIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
