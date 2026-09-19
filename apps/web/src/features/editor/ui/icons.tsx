/**
 * 編輯器用的極簡 icon 組。
 *
 * 為什麼不用 `@kennote/ui` 的 icons：寫這支的時候 `packages/ui/src/index.ts`
 * 只 export 了 store 與 useQuery（icons 由 UI 代理進行中）。等它 export 之後，
 * 把 `ICON_PATHS` 換成從 `@kennote/ui` re-export 即可（見 README「決策」）。
 *
 * 全部是 16x16 viewBox 的 stroke icon，用 currentColor。
 */
import type { SVGProps } from 'react';

export type IconName =
  | 'text'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'list-bulleted'
  | 'list-numbered'
  | 'checkbox'
  | 'toggle'
  | 'quote'
  | 'callout'
  | 'divider'
  | 'code'
  | 'image'
  | 'file'
  | 'video'
  | 'bookmark'
  | 'embed'
  | 'equation'
  | 'toc'
  | 'page'
  | 'columns'
  | 'column'
  | 'table'
  | 'table-row'
  | 'database'
  | 'box'
  | 'plus'
  | 'grip'
  | 'chevron-down'
  | 'chevron-right'
  | 'trash'
  | 'copy'
  | 'link'
  | 'palette'
  | 'comment'
  | 'sparkle'
  | 'arrow-right'
  | 'upload'
  | 'download'
  | 'close'
  | 'check'
  | 'search'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'at'
  | 'calendar'
  | 'user'
  | 'move'
  | 'align-left'
  | 'align-center'
  | 'align-right';

/** 每個 icon 一到三段 path（stroke，不填色） */
const ICON_PATHS: Record<IconName, string[]> = {
  text: ['M3 4h10M6 4v8M6 12h0.01'],
  'heading-1': ['M3 3v10M9 3v10M3 8h6', 'M12 6.5l1.5-1v7.5'],
  'heading-2': ['M3 3v10M9 3v10M3 8h6', 'M11.5 7a1.5 1.5 0 1 1 3 0c0 1.5-3 2.5-3 5h3'],
  'heading-3': ['M3 3v10M9 3v10M3 8h6', 'M11.5 6h3l-2 2.5a1.75 1.75 0 1 1-1 3'],
  'list-bulleted': ['M6 4h8M6 8h8M6 12h8', 'M3 4h0.01M3 8h0.01M3 12h0.01'],
  'list-numbered': ['M6 4h8M6 8h8M6 12h8', 'M2 3.5l1-0.5v3M2 12.5h2M2 10.5h2v2'],
  checkbox: ['M2.5 3.5h11v9h-11z', 'M5.5 8l2 2 3.5-4'],
  toggle: ['M6 4.5l4 3.5-4 3.5z'],
  quote: ['M4 3v10', 'M7 5h6M7 8h6M7 11h4'],
  callout: ['M2.5 3.5h11v9h-11z', 'M8 6v3M8 11h0.01'],
  divider: ['M2 8h12'],
  code: ['M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3'],
  image: ['M2.5 3.5h11v9h-11z', 'M2.5 10l3-3 3 3 2-2 3 3', 'M10.5 6h0.01'],
  file: ['M4 2h5l3 3v9H4z', 'M9 2v3h3'],
  video: ['M2.5 4h11v8h-11z', 'M6.5 6.5l4 1.5-4 1.5z'],
  bookmark: ['M4 2h8v12l-4-3-4 3z'],
  embed: ['M2.5 3.5h11v9h-11z', 'M2.5 6h11'],
  equation: ['M4 13l4-10M3 8h7', 'M11 6l3 4M14 6l-3 4'],
  toc: ['M3 4h10M5 8h8M5 12h6', 'M3 8h0.01M3 12h0.01'],
  page: ['M4 2h5l3 3v9H4z', 'M9 2v3h3', 'M6 9h4M6 11h3'],
  columns: ['M2.5 3.5h11v9h-11z', 'M8 3.5v9'],
  column: ['M5 3.5h6v9H5z'],
  table: ['M2.5 3.5h11v9h-11z', 'M2.5 6.5h11M6 3.5v9M10 3.5v9'],
  'table-row': ['M2.5 3.5h11v9h-11z', 'M2.5 6.5h11M2.5 9.5h11'],
  database: ['M3 4c0-1 2.2-1.8 5-1.8S13 3 13 4v8c0 1-2.2 1.8-5 1.8S3 13 3 12z', 'M3 4c0 1 2.2 1.8 5 1.8S13 5 13 4M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8'],
  box: ['M2.5 3.5h11v9h-11z'],
  plus: ['M8 3v10M3 8h10'],
  grip: ['M6 3.5h0.01M10 3.5h0.01M6 8h0.01M10 8h0.01M6 12.5h0.01M10 12.5h0.01'],
  'chevron-down': ['M4 6l4 4 4-4'],
  'chevron-right': ['M6 4l4 4-4 4'],
  trash: ['M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l0.7 9h5.6l0.7-9'],
  copy: ['M5.5 5.5h8v8h-8z', 'M3 10.5V2.5h8'],
  link: ['M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-1 1', 'M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7.5 12l1-1'],
  palette: ['M8 2a6 6 0 1 0 0 12c1 0 1.5-.6 1.5-1.3 0-.8-.8-1.2-.8-2 0-.6.5-1.2 1.2-1.2H11A3 3 0 0 0 14 6.5C14 3.9 11.3 2 8 2z', 'M5 7h0.01M8 5h0.01M11 7h0.01'],
  comment: ['M2.5 3.5h11v7h-6l-3 3v-3h-2z'],
  sparkle: ['M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3z'],
  'arrow-right': ['M3 8h10M9 4l4 4-4 4'],
  upload: ['M8 11V3M5 6l3-3 3 3', 'M3 11v2h10v-2'],
  download: ['M8 3v8M5 8l3 3 3-3', 'M3 12v1h10v-1'],
  close: ['M4 4l8 8M12 4l-8 8'],
  check: ['M3 8.5l3.5 3.5L13 5'],
  search: ['M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z', 'M10.5 10.5l3 3'],
  bold: ['M4.5 3h4a2.5 2.5 0 0 1 0 5h-4z', 'M4.5 8h4.5a2.5 2.5 0 0 1 0 5H4.5z'],
  italic: ['M6.5 3h5M4.5 13h5M9.5 3l-3 10'],
  underline: ['M4.5 2.5v5a3.5 3.5 0 0 0 7 0v-5', 'M3.5 13.5h9'],
  strike: ['M3 8h10', 'M11.5 4.5C11 3.4 9.7 2.8 8 2.8c-2 0-3.2 1-3.2 2.3 0 1 .7 1.7 2 2.1M4.5 11c.6 1.2 1.9 1.9 3.6 1.9 2.1 0 3.4-1 3.4-2.4 0-.6-.2-1.1-.6-1.5'],
  at: ['M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM10.5 8v1.2c0 1 .7 1.6 1.6 1.6 1 0 1.6-.8 1.6-2.2A6 6 0 1 0 10.5 13.6'],
  calendar: ['M2.5 4h11v9.5h-11z', 'M2.5 7h11M5.5 2.5v3M10.5 2.5v3'],
  user: ['M8 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z', 'M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4'],
  move: ['M8 2v12M2 8h12', 'M5.5 4.5L8 2l2.5 2.5M5.5 11.5L8 14l2.5-2.5M4.5 5.5L2 8l2.5 2.5M11.5 5.5L14 8l-2.5 2.5'],
  'align-left': ['M2.5 4h11M2.5 8h7M2.5 12h11'],
  'align-center': ['M2.5 4h11M4.5 8h7M2.5 12h11'],
  'align-right': ['M2.5 4h11M6.5 8h7M2.5 12h11'],
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName | string;
  size?: number;
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  const paths = ICON_PATHS[name as IconName] ?? ICON_PATHS.box;
  return (
    <svg
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
      {...rest}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

export function hasIcon(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, name);
}
