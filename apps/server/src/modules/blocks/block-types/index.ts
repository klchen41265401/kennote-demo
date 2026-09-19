/**
 * 唯一需要碰的「註冊清單」。
 * 新增 block 型別：shared-types 的 BlockType union 加一個字串，
 * 0002 migration 的 chk_blocks_type 加一個值，然後在這裡 defineBlockType 一次。
 */
import { z } from 'zod';
import { defineBlockType } from './types.js';

export * from './types.js';

const BLOCK_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
  'gray_background',
  'brown_background',
  'orange_background',
  'yellow_background',
  'green_background',
  'blue_background',
  'purple_background',
  'pink_background',
  'red_background',
] as const;

const color = z.enum(BLOCK_COLORS).optional();

/** RichText 的結構驗證：InlineSpan | InlineAtom（04 §4.2） */
const markSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('b') }),
  z.object({ t: z.literal('i') }),
  z.object({ t: z.literal('u') }),
  z.object({ t: z.literal('s') }),
  z.object({ t: z.literal('code') }),
  z.object({ t: z.literal('link'), href: z.string().max(2000) }),
  z.object({ t: z.literal('color'), fg: z.string().optional(), bg: z.string().optional() }),
  z.object({ t: z.literal('comment'), id: z.string() }),
]);

export const richTextSchema = z.array(
  z.union([
    z.object({ text: z.string(), marks: z.array(markSchema).optional() }).strict(),
    z
      .object({
        atom: z.enum(['mention', 'date', 'pageLink', 'equation']),
        data: z.record(z.unknown()),
        marks: z.array(markSchema).optional(),
      })
      .strict(),
  ]),
);

const base = z.object({ color }).strict();
const empty = z.object({}).strict();

const mediaSchema = z
  .object({
    color,
    fileId: z.string().uuid().nullable().optional(),
    externalUrl: z.string().max(2000).nullable().optional(),
    caption: richTextSchema.optional(),
    altText: z.string().max(1000).optional(),
    width: z.number().positive().max(4000).optional(),
    aspectRatio: z.number().positive().optional(),
    alignment: z.enum(['left', 'center', 'right']).optional(),
  })
  .strict();

/* ── 文字類 ───────────────────────────────────────────── */
defineBlockType({ type: 'paragraph', schema: base, defaultProps: {} });
defineBlockType({
  type: 'heading1',
  schema: z.object({ color, toggleable: z.boolean().optional() }).strict(),
  defaultProps: {},
});
defineBlockType({
  type: 'heading2',
  schema: z.object({ color, toggleable: z.boolean().optional() }).strict(),
  defaultProps: {},
});
defineBlockType({
  type: 'heading3',
  schema: z.object({ color, toggleable: z.boolean().optional() }).strict(),
  defaultProps: {},
});
defineBlockType({ type: 'bulletedList', schema: base, defaultProps: {} });
defineBlockType({ type: 'numberedList', schema: base, defaultProps: {} });
defineBlockType({
  type: 'todo',
  schema: z.object({ color, checked: z.boolean().default(false) }).strict(),
  defaultProps: { checked: false },
});
defineBlockType({
  type: 'toggle',
  schema: z.object({ color, defaultOpen: z.boolean().optional() }).strict(),
  defaultProps: {},
});
defineBlockType({ type: 'quote', schema: base, defaultProps: {} });
defineBlockType({
  type: 'callout',
  schema: z.object({ color, icon: z.string().max(64).nullable().optional() }).strict(),
  defaultProps: { icon: '💡' },
});

/* ── 無行內內容 ───────────────────────────────────────── */
defineBlockType({
  type: 'divider',
  schema: empty,
  defaultProps: {},
  canHaveChildren: false,
  hasInlineContent: false,
});
defineBlockType({
  type: 'tableOfContents',
  schema: base,
  defaultProps: {},
  canHaveChildren: false,
  hasInlineContent: false,
});

/* ── 程式碼 / 數學 ────────────────────────────────────── */
defineBlockType({
  type: 'code',
  schema: z
    .object({
      color,
      language: z.string().max(40).default('plain'),
      wrap: z.boolean().optional(),
      lineNumbers: z.boolean().optional(),
      caption: richTextSchema.optional(),
    })
    .strict(),
  defaultProps: { language: 'plain' },
  canHaveChildren: false,
});
defineBlockType({
  type: 'equation',
  schema: z.object({ color, expression: z.string().max(10_000).default('') }).strict(),
  defaultProps: { expression: '' },
  canHaveChildren: false,
  hasInlineContent: false,
});

/* ── 媒體 ─────────────────────────────────────────────── */
defineBlockType({
  type: 'image',
  schema: mediaSchema,
  defaultProps: {},
  canHaveChildren: false,
  hasInlineContent: false,
});
defineBlockType({
  type: 'video',
  schema: mediaSchema,
  defaultProps: {},
  canHaveChildren: false,
  hasInlineContent: false,
});
defineBlockType({
  type: 'file',
  schema: mediaSchema.extend({
    name: z.string().max(500).optional(),
    size: z.number().nonnegative().optional(),
  }),
  defaultProps: {},
  canHaveChildren: false,
  hasInlineContent: false,
});
defineBlockType({
  type: 'bookmark',
  schema: z
    .object({
      color,
      url: z.string().max(2000).default(''),
      caption: richTextSchema.optional(),
      meta: z
        .object({
          title: z.string().optional(),
          description: z.string().optional(),
          faviconUrl: z.string().optional(),
          coverUrl: z.string().optional(),
          fetchedAt: z.string().optional(),
          status: z.enum(['ok', 'error', 'pending']).optional(),
        })
        .optional(),
    })
    .strict(),
  defaultProps: { url: '' },
  canHaveChildren: false,
  hasInlineContent: false,
});
defineBlockType({
  type: 'embed',
  schema: z
    .object({
      color,
      url: z.string().max(2000).default(''),
      caption: richTextSchema.optional(),
      height: z.number().positive().max(4000).optional(),
    })
    .strict(),
  defaultProps: { url: '' },
  canHaveChildren: false,
  hasInlineContent: false,
});

/* ── 結構 ─────────────────────────────────────────────── */
defineBlockType({
  type: 'page',
  schema: z.object({ color, pageId: z.string().uuid().nullable().default(null) }).strict(),
  defaultProps: { pageId: null },
  canHaveChildren: false,
  hasInlineContent: false,
});
defineBlockType({
  type: 'columnList',
  schema: empty,
  defaultProps: {},
  hasInlineContent: false,
});
defineBlockType({
  type: 'column',
  schema: z.object({ ratio: z.number().min(0).max(1).default(0.5) }).strict(),
  defaultProps: { ratio: 0.5 },
  hasInlineContent: false,
});
defineBlockType({
  type: 'table',
  schema: z
    .object({
      color,
      columnCount: z.number().int().min(1).max(50).default(3),
      hasColumnHeader: z.boolean().optional(),
      hasRowHeader: z.boolean().optional(),
      columnWidths: z.array(z.number().positive()).optional(),
    })
    .strict(),
  defaultProps: { columnCount: 3 },
  hasInlineContent: false,
});
defineBlockType({
  type: 'tableRow',
  schema: z.object({ cells: z.array(richTextSchema).default([]) }).strict(),
  defaultProps: { cells: [] },
  canHaveChildren: false,
  hasInlineContent: false,
});
defineBlockType({
  type: 'collectionView',
  schema: z
    .object({
      color,
      collectionId: z.string().uuid().nullable().default(null),
      viewIds: z.array(z.string().uuid()).default([]),
      height: z.number().positive().optional(),
    })
    .strict(),
  defaultProps: { collectionId: null, viewIds: [] },
  canHaveChildren: false,
  hasInlineContent: false,
});
