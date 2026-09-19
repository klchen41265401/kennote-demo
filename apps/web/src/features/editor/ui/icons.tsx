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
  | 'align-right'
  /* ── M2-C：斜線選單補齊（Notion 7.34）── */
  | 'heading-4'
  | 'audio'
  | 'pdf'
  | 'breadcrumb'
  | 'button'
  | 'synced'
  | 'tabs'
  | 'toggle-heading'
  | 'link-to-page'
  | 'mermaid'
  | 'ai'
  | 'emoji'
  | 'equation-inline'
  | 'db-table'
  | 'db-board'
  | 'db-gallery'
  | 'db-list'
  | 'db-feed'
  | 'db-dashboard'
  | 'db-calendar'
  | 'db-timeline'
  | 'db-map'
  | 'db-inline'
  | 'db-fullpage'
  | 'db-link'
  | 'chart-bar-v'
  | 'chart-bar-h'
  | 'chart-line'
  | 'chart-donut'
  | 'chart-number'
  | 'form'
  | 'html'
  | 'drive'
  | 'twitter'
  | 'github'
  | 'map'
  | 'figma'
  | 'csv'
  | 'markdown'
  | 'zip'
  | 'word'
  | 'import';

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

  /* ── M2-C：斜線選單補齊 ─────────────────────────── */
  'heading-4': ['M3 3v10M9 3v10M3 8h6', 'M13.5 13V6l-2.8 4.6h4.1'],
  audio: ['M4 6.5v3M7 4.5v7.5M10 6v4.5M13 7.5v1.5'],
  pdf: ['M4 2h5l3 3v9H4z', 'M9 2v3h3', 'M5.8 11.6V8.9h1a.9.9 0 0 1 0 1.8h-1'],
  breadcrumb: ['M2 8h2.5M7 8h2.5M12 8h2', 'M5.6 6.4L7.2 8l-1.6 1.6M10.6 6.4L12.2 8l-1.6 1.6'],
  button: ['M2.5 5h11v6h-11z', 'M5.5 8h5'],
  synced: ['M3.2 8a4.8 4.8 0 0 1 8.2-3.4M12.8 8a4.8 4.8 0 0 1-8.2 3.4', 'M11.4 2.2v2.4H9M4.6 13.8v-2.4H7'],
  tabs: ['M2.5 5.5h4.5v-2h6.5v9h-11z', 'M2.5 5.5h4.5'],
  'toggle-heading': ['M3 5l2.5 3L3 11z', 'M7.5 3.5v9M13 3.5v9M7.5 8h5.5'],
  'link-to-page': ['M4 2h5l3 3v9H4z', 'M9 2v3h3', 'M6.2 10.2a1.6 1.6 0 0 0 2.3 0l1-1a1.6 1.6 0 0 0-2.3-2.3'],
  mermaid: ['M2.5 2.5h4.5v3h-4.5z', 'M9 10.5h4.5v3H9z', 'M4.75 5.5v3.5h6.5v1.5'],
  ai: ['M6.5 2l1 2.8L10 5.8 7.5 6.9 6.5 9.7 5.5 6.9 3 5.8l2.5-1z', 'M11.5 9l.6 1.6 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z'],
  emoji: ['M8 2.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6z', 'M5.6 9.2c.5.9 1.4 1.4 2.4 1.4s1.9-.5 2.4-1.4', 'M6 6.3h.01M10 6.3h.01'],
  'equation-inline': ['M2.5 3.5h11v9h-11z', 'M6 11l3-6M5.5 8h4.5'],
  'db-table': ['M2.5 3.5h11v9h-11z', 'M2.5 6.5h11M2.5 9.5h11M6.5 3.5v9'],
  'db-board': ['M2.5 3.5h3.2v9H2.5z', 'M6.9 3.5h3.2v6H6.9z', 'M11.3 3.5h2.2v7.5h-2.2z'],
  'db-gallery': ['M2.5 3.5h5v4.5h-5z', 'M8.5 3.5h5v4.5h-5z', 'M2.5 9h5v3.5h-5z', 'M8.5 9h5v3.5h-5z'],
  'db-list': ['M2.5 4.5h11M2.5 8h11M2.5 11.5h11'],
  'db-feed': ['M2.5 3.5h11v4h-11z', 'M2.5 9h7M2.5 11.5h11'],
  'db-dashboard': ['M2.5 3.5h5.5v4h-5.5z', 'M9.5 3.5h4v8h-4z', 'M2.5 9h5.5v3.5h-5.5z'],
  'db-calendar': ['M2.5 4h11v9.5h-11z', 'M2.5 7h11M5.5 2.5v3M10.5 2.5v3'],
  'db-timeline': ['M2.5 4.5h6v2h-6z', 'M5.5 7.5h8v2h-8z', 'M3.5 10.5h6v2h-6z'],
  'db-map': ['M2.5 4.5l3.7-1.6 3.6 1.6 3.7-1.6v9l-3.7 1.6-3.6-1.6-3.7 1.6z', 'M6.2 2.9v9.1M9.8 4.5v9.1'],
  'db-inline': ['M2.5 3.5h11v9h-11z', 'M4.5 6h7M4.5 8.5h7M4.5 11h4'],
  'db-fullpage': ['M4 2h5l3 3v9H4z', 'M9 2v3h3', 'M5.8 8h4.4M5.8 10.4h3'],
  'db-link': ['M2.5 3.5h11v9h-11z', 'M2.5 6.5h11', 'M6.2 10.4a1.5 1.5 0 0 0 2.1 0l1-1a1.5 1.5 0 0 0-2.1-2.1'],
  'chart-bar-v': ['M3 13V8M6.3 13V4.5M9.6 13V9.5M12.9 13V6.5'],
  'chart-bar-h': ['M3 3.2h5M3 6.5h9M3 9.8h4M3 13h7'],
  'chart-line': ['M2.5 11.5l3-3.5 2.6 2 4.4-5.5', 'M2.5 13.5h11'],
  'chart-donut': ['M8 2.4a5.6 5.6 0 1 1-5.4 7.1', 'M8 5.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2z'],
  'chart-number': ['M3.5 6l1.6-1v6', 'M8.5 5.5h4l-2.4 3a2 2 0 1 1-1.7 3'],
  form: ['M3.5 2.5h9v11h-9z', 'M5.5 5.5h5M5.5 8h5M5.5 10.5h3'],
  html: ['M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3', 'M9.2 3.6l-2.4 8.8'],
  drive: ['M6.2 2.4h3.6l4 7h-3.6z', 'M6.2 2.4l-4 7 1.8 3.2 4-7z', 'M4 12.6h7.9l1.9-3.2H5.8z'],
  twitter: ['M2.6 3h3.1l7.7 10h-3.1z', 'M2.9 13l4.3-4.6M9.1 7.2l4-4.2'],
  github: ['M6.2 13.4c-2.8.8-2.8-1.6-4-2m8 3.4v-2.4c0-.7-.1-1 .3-1.4 1.9-.2 3.6-.9 3.6-4a3 3 0 0 0-.8-2.1 2.8 2.8 0 0 0-.1-2.1s-.8-.2-2.5 1a8.5 8.5 0 0 0-4.4 0C4.6 2.1 3.8 2.3 3.8 2.3a2.8 2.8 0 0 0-.1 2.1 3 3 0 0 0-.8 2.1c0 3.1 1.7 3.8 3.6 4-.4.4-.4.8-.3 1.4v2.5'],
  map: ['M2.5 4.5l3.7-1.6 3.6 1.6 3.7-1.6v9l-3.7 1.6-3.6-1.6-3.7 1.6z', 'M6.2 2.9v9.1M9.8 4.5v9.1'],
  figma: ['M6.5 2.2h3v3h-3a1.5 1.5 0 0 1 0-3z', 'M6.5 5.2h3v3h-3a1.5 1.5 0 0 1 0-3z', 'M6.5 8.2h3v3h-3a1.5 1.5 0 0 1 0-3z', 'M9.5 5.2h.1a1.5 1.5 0 0 1 0 3h-.1'],
  csv: ['M4 2h5l3 3v9H4z', 'M9 2v3h3', 'M6 8.5h4M6 11h4'],
  markdown: ['M2.5 4.5h11v7h-11z', 'M4.5 10V6l1.6 2 1.6-2v4', 'M10 6v3.4M10 9.4h1.8'],
  zip: ['M4 2h5l3 3v9H4z', 'M9 2v3h3', 'M7 2.6v1.2M8 3.8v1.2M7 5v1.2M8 6.2v1.2M7 7.4v1.2'],
  word: ['M4 2h5l3 3v9H4z', 'M9 2v3h3', 'M5.6 8l1 3.2L7.8 8.6l1.2 2.6 1-3.2'],
  import: ['M8 2.5v7M5 6.5l3 3 3-3', 'M3 11.5v2h10v-2'],
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
