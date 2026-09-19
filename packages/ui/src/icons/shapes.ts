/**
 * 自建 SVG icon 集（不裝 lucide / heroicons）。
 * 風格：20x20 viewBox、1.5px 線條、currentColor、round cap/join —— 對齊 Notion。
 *
 * 形狀以極小的 DSL 描述，避免 70+ 個 icon 寫成 70+ 個 JSX 元件。
 */

export type IconShape =
  | string
  | { p: string; fill?: boolean }
  | { circle: [cx: number, cy: number, r: number]; fill?: boolean }
  | { rect: [x: number, y: number, w: number, h: number, rx?: number]; fill?: boolean };

/** 逗號分隔的多個 path 會被拆成多個 <path>；這裡直接用一個 path 的多段 d。 */
export const ICON_SHAPES = {
  'chevron-right': ['M8 5l5 5-5 5'],
  'chevron-down': ['M5 8l5 5 5-5'],
  'chevron-left': ['M12 5l-5 5 5 5'],
  'chevron-up': ['M5 12l5-5 5 5'],
  plus: ['M10 4v12M4 10h12'],
  search: [{ circle: [9, 9, 5] }, 'M12.8 12.8L16.5 16.5'],
  home: ['M3.5 9.5L10 4l6.5 5.5V16a1 1 0 0 1-1 1h-3v-4h-5v4h-3a1 1 0 0 1-1-1z'],
  inbox: ['M3 11h4l1 2h4l1-2h4M3 11l2-6h10l2 6v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z'],
  settings: [
    { circle: [10, 10, 2.5] },
    'M10 3v2M10 15v2M3 10h2M15 10h2M5.2 5.2l1.4 1.4M13.4 13.4l1.4 1.4M14.8 5.2l-1.4 1.4M6.6 13.4l-1.4 1.4',
  ],
  trash: ['M4 6h12M8 6V4h4v2M6 6l.8 10a1 1 0 0 0 1 1h4.4a1 1 0 0 0 1-1L14 6M8.5 9v5M11.5 9v5'],
  star: ['M10 3.5l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7L3.2 8.5l4.7-.7z'],
  'star-filled': [
    { p: 'M10 3.5l2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7L3.2 8.5l4.7-.7z', fill: true },
  ],
  'more-horizontal': [
    { circle: [5, 10, 1.4], fill: true },
    { circle: [10, 10, 1.4], fill: true },
    { circle: [15, 10, 1.4], fill: true },
  ],
  'more-vertical': [
    { circle: [10, 5, 1.4], fill: true },
    { circle: [10, 10, 1.4], fill: true },
    { circle: [10, 15, 1.4], fill: true },
  ],
  /** ⠿ 六點把手 */
  'drag-handle': [
    { circle: [7.5, 5.5, 1.25], fill: true },
    { circle: [12.5, 5.5, 1.25], fill: true },
    { circle: [7.5, 10, 1.25], fill: true },
    { circle: [12.5, 10, 1.25], fill: true },
    { circle: [7.5, 14.5, 1.25], fill: true },
    { circle: [12.5, 14.5, 1.25], fill: true },
  ],
  page: ['M5 3h6l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 3v4h4', 'M7 11h6M7 14h4'],
  'page-empty': ['M5 3h6l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 3v4h4'],
  database: [
    'M4 5.5c0-1.4 2.7-2.5 6-2.5s6 1.1 6 2.5-2.7 2.5-6 2.5-6-1.1-6-2.5z',
    'M16 5.5v9c0 1.4-2.7 2.5-6 2.5s-6-1.1-6-2.5v-9M16 10c0 1.4-2.7 2.5-6 2.5S4 11.4 4 10',
  ],
  table: [{ rect: [3, 4, 14, 12, 1.5] }, 'M3 8h14M3 12h14M8 4v12'],
  board: [
    { rect: [3, 4, 4, 9, 1] },
    { rect: [8, 4, 4, 12, 1] },
    { rect: [13, 4, 4, 7, 1] },
  ],
  list: [
    { circle: [4.5, 6, 1.1], fill: true },
    { circle: [4.5, 10, 1.1], fill: true },
    { circle: [4.5, 14, 1.1], fill: true },
    'M8 6h8M8 10h8M8 14h8',
  ],
  gallery: [
    { rect: [3, 3, 6, 6, 1] },
    { rect: [11, 3, 6, 6, 1] },
    { rect: [3, 11, 6, 6, 1] },
    { rect: [11, 11, 6, 6, 1] },
  ],
  calendar: [{ rect: [3, 4, 14, 13, 2] }, 'M3 8h14M7 3v3M13 3v3'],
  timeline: ['M3 6h8M6 10h10M3 14h6'],
  comment: ['M4 5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-4 4V5z'],
  history: ['M4 10a6 6 0 1 0 1.8-4.3M4 4.2V7.5h3.3', 'M10 7v3.5l2.5 1.5'],
  share: ['M10 3v9M10 3L7 6M10 3l3 3', 'M5 10v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5'],
  duplicate: [
    { rect: [7, 7, 9, 9, 1.5] },
    'M13 7V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2',
  ],
  link: [
    'M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-1 1',
    'M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l1-1',
  ],
  check: ['M4.5 10.5l3.5 3.5 7.5-8'],
  close: ['M5 5l10 10M15 5L5 15'],
  'arrow-left': ['M16 10H4M4 10l5-5M4 10l5 5'],
  'arrow-right': ['M4 10h12M16 10l-5-5M16 10l-5 5'],
  'arrow-up': ['M10 16V4M10 4L5 9M10 4l5 5'],
  'arrow-down': ['M10 4v12M10 16l-5-5M10 16l5-5'],
  'sidebar-toggle': [{ rect: [3, 4, 14, 12, 1.5] }, 'M8 4v12'],
  sun: [
    { circle: [10, 10, 3.4] },
    'M10 2.6v1.6M10 15.8v1.6M2.6 10h1.6M15.8 10h1.6M4.9 4.9l1.2 1.2M13.9 13.9l1.2 1.2M15.1 4.9l-1.2 1.2M6.1 13.9l-1.2 1.2',
  ],
  moon: ['M15.6 12.6A6.6 6.6 0 0 1 7.4 4.4a6.6 6.6 0 1 0 8.2 8.2z'],
  bold: ['M6 4h4.4a3 3 0 0 1 0 6H6zM6 10h5a3 3 0 0 1 0 6H6z'],
  italic: ['M12.5 4h-4M11.5 16h-4M11 4L9 16'],
  underline: ['M6 4v5a4 4 0 0 0 8 0V4M5.5 16.5h9'],
  strikethrough: [
    'M3.5 10h13',
    'M13.4 6.6C12.9 5.1 11.6 4 10 4 8 4 6.5 5.2 6.5 7c0 1.2 1 2.2 2.5 2.7M6.6 13c.5 1.8 1.8 3 3.4 3 2 0 3.5-1.2 3.5-3 0-.6-.2-1.1-.5-1.5',
  ],
  code: ['M7.5 6L4 10l3.5 4M12.5 6l3.5 4-3.5 4'],
  'text-color': ['M5.5 13.5l4-9h1l4 9M7 11h6', { rect: [4, 15.5, 12, 2, 1], fill: true }],
  undo: ['M6.5 6.5l-3 3 3 3', 'M3.5 9.5H11a4 4 0 0 1 0 8H8.5'],
  redo: ['M13.5 6.5l3 3-3 3', 'M16.5 9.5H9a4 4 0 0 0 0 8h2.5'],
  image: [{ rect: [3, 4, 14, 12, 1.5] }, { circle: [7.3, 8.3, 1.3] }, 'M3.6 14.5l4.4-4.5 3 3 2.5-2.5 3.5 3.5'],
  file: ['M5 3h6l4 4v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 3v4h4'],
  bookmark: ['M5.5 3.5h9a1 1 0 0 1 1 1V17l-5.5-3.6L4.5 17V4.5a1 1 0 0 1 1-1z'],
  divider: ['M3 10h14'],
  quote: [{ rect: [4, 4, 2, 12, 1], fill: true }, 'M9 7h7M9 11h7M9 15h4'],
  callout: [
    { rect: [3, 4, 14, 12, 2] },
    'M10 7.3a2.2 2.2 0 0 1 1.3 4v.9H8.7v-.9A2.2 2.2 0 0 1 10 7.3zM8.9 13.6h2.2',
  ],
  todo: [{ rect: [3.5, 3.5, 13, 13, 3] }, 'M6.5 10l2.6 2.6 4.4-5'],
  'bulleted-list': [
    { circle: [4.5, 6, 1.3], fill: true },
    { circle: [4.5, 10, 1.3], fill: true },
    { circle: [4.5, 14, 1.3], fill: true },
    'M8 6h8M8 10h8M8 14h8',
  ],
  'numbered-list': [
    'M3.6 5.1l1.1-.7v3.4M3.4 10.4a1.1 1.1 0 1 1 1.9.9L3.4 13.6h2.1M3.5 14.9a1.1 1.1 0 1 1 1 1.6h-.2.2a1.1 1.1 0 1 1-1 1.6',
    'M8 6h8M8 12h8M8 16.5h8',
  ],
  toggle: [{ p: 'M8 6.3l4.2 3.7-4.2 3.7z', fill: true }],
  heading1: ['M3.5 5v10M3.5 10h6M9.5 5v10', 'M13.5 8.8l1.6-1.1V15'],
  heading2: ['M3.5 5v10M3.5 10h6M9.5 5v10', 'M12.9 9.3a1.7 1.7 0 1 1 3 1.2L12.9 15h3.3'],
  heading3: ['M3.5 5v10M3.5 10h6M9.5 5v10', 'M13 9a1.6 1.6 0 1 1 1.4 2.4h-.3.3A1.7 1.7 0 1 1 13 13.9'],
  text: ['M4 5h12M10 5v10M7.5 15h5'],
  paragraph: ['M13 4H9.5a3 3 0 0 0 0 6H11M11 4v12M14 4v12'],
  filter: ['M3.5 5h13l-5 6v5l-3-2v-3z'],
  sort: ['M6 4v12M6 16l-2.5-2.5M6 16l2.5-2.5', 'M14 16V4M14 4l-2.5 2.5M14 4l2.5 2.5'],
  group: [{ rect: [3, 4, 14, 5, 1.5] }, { rect: [3, 11, 14, 5, 1.5] }],
  hide: [
    'M4 4l12 12',
    'M8.2 8.3a2.5 2.5 0 0 0 3.5 3.5',
    'M6.3 6.5C4.5 7.6 3 10 3 10s2.8 4.5 7 4.5c1.4 0 2.6-.4 3.6-1M15.2 12.6C16.4 11.6 17 10 17 10s-2.8-4.5-7-4.5c-.5 0-1 .1-1.4.2',
  ],
  lock: [{ rect: [4.5, 9, 11, 8, 1.5] }, 'M7 9V7a3 3 0 0 1 6 0v2'],
  globe: [
    { circle: [10, 10, 7] },
    'M3 10h14M10 3c2 2.2 3 4.6 3 7s-1 4.8-3 7c-2-2.2-3-4.6-3-7s1-4.8 3-7z',
  ],
  user: [{ circle: [10, 7.3, 3.2] }, 'M4.5 16.8c0-2.9 2.5-4.6 5.5-4.6s5.5 1.7 5.5 4.6'],
  users: [
    { circle: [8, 7.3, 3] },
    'M2.5 16.8c0-2.7 2.4-4.3 5.5-4.3 1.2 0 2.3.2 3.2.7',
    'M13.3 4.9a3 3 0 0 1 0 5.8M13.8 12.6c2 .5 3.7 1.9 3.7 4.2',
  ],
  bell: [
    'M10 3.4a4.6 4.6 0 0 1 4.6 4.6v3.2l1.4 2.3H4l1.4-2.3V8A4.6 4.6 0 0 1 10 3.4z',
    'M8.3 13.5a1.8 1.8 0 0 0 3.4 0',
  ],
  help: [{ circle: [10, 10, 7] }, 'M8.2 8.1a1.9 1.9 0 1 1 2.4 2.2c-.4.2-.6.5-.6 1M10 14.1h.01'],
  template: [{ rect: [3, 4, 14, 12, 1.5] }, 'M3 8h14M6.5 11h7M6.5 13.5h4'],
  import: ['M10 3v8M10 11.2L7 8.2M10 11.2l3-3', 'M4 13v2a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 15v-2'],
  export: ['M10 11.2V3M10 3L7 6M10 3l3 3', 'M4 13v2a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 16 15v-2'],
  expand: ['M8.5 4.5h-4v4M11.5 15.5h4v-4', 'M4.5 4.5l4.5 4.5M15.5 15.5L11 11'],
  collapse: ['M8.5 8.5h-4M8.5 8.5v-4M11.5 11.5h4M11.5 11.5v4', 'M8.5 8.5L3.8 3.8M11.5 11.5l4.7 4.7'],
  'external-link': [
    'M12 4h4v4M16 4l-6.3 6.3',
    'M14 11.5V15a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 4 15V8a1.5 1.5 0 0 1 1.5-1.5H9',
  ],
  sync: ['M15.8 8.2A6 6 0 0 0 5 6.4M4.2 11.8A6 6 0 0 0 15 13.6', 'M15.8 4.6v3.6h-3.6M4.2 15.4v-3.6h3.6'],
  reload: ['M16.2 10a6.2 6.2 0 1 1-1.9-4.4', 'M16.2 3.2v3.6h-3.6'],
  emoji: [{ circle: [10, 10, 7] }, 'M7.6 8.6h.01M12.4 8.6h.01M7.1 12a3.7 3.7 0 0 0 5.8 0'],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICON_SHAPES;

export const ICON_NAMES = Object.keys(ICON_SHAPES) as IconName[];
