/**
 * Transaction / Operation 的**純驗證邏輯**（無 DB、無 HTTP）。
 * 這是 04 §8 M2-B 驗收標準「送出不合法的 operation → 回 400 且整批不套用」的第一道關卡。
 */
import { BLOCK_TYPES, MAX_OPS_PER_TRANSACTION, type Operation, type Transaction } from '@kennote/shared-types';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { getBlockType, richTextSchema } from './block-types/index.js';

const uuid = z.string().uuid('必須是 UUID');
const blockTypeSchema = z.enum(BLOCK_TYPES);

const operationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('block.insert'),
    blockId: uuid,
    parentId: uuid.nullable(),
    afterId: uuid.nullable(),
    blockType: blockTypeSchema,
    props: z.record(z.unknown()).default({}),
    content: richTextSchema.default([]),
  }),
  z.object({
    type: z.literal('block.update'),
    blockId: uuid,
    patch: z
      .object({
        blockType: blockTypeSchema.optional(),
        props: z.record(z.unknown()).optional(),
        content: richTextSchema.optional(),
      })
      .refine((p) => Object.keys(p).length > 0, { message: 'patch 不可為空' }),
    baseVersion: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('block.move'),
    blockId: uuid,
    parentId: uuid.nullable(),
    afterId: uuid.nullable(),
  }),
  z.object({ type: z.literal('block.delete'), blockId: uuid }),
  z.object({
    type: z.literal('page.update'),
    patch: z
      .object({
        title: richTextSchema.optional(),
        icon: z.string().max(64).nullable().optional(),
        cover: z.string().max(2000).nullable().optional(),
      })
      .refine((p) => Object.keys(p).length > 0, { message: 'patch 不可為空' }),
  }),
  z.object({
    type: z.literal('text.delta'),
    blockId: uuid,
    delta: z.object({ ops: z.array(z.record(z.unknown())) }),
    baseRev: z.number().int().nonnegative(),
  }),
]);

export const transactionSchema = z.object({
  txId: uuid,
  pageId: uuid.optional(),
  originSessionId: z.string().max(200).default('http'),
  ops: z.array(operationSchema).min(1, '至少要有一個 operation').max(MAX_OPS_PER_TRANSACTION),
});

/**
 * 解析並驗證整批 operation。任何一個不合法 → 整批拒絕（原子性的第一層）。
 * 同時對每個 block.insert / block.update 跑 block type registry 的 props 驗證。
 */
export function parseTransaction(input: unknown, pageId: string): Transaction {
  const parsed = transactionSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError('INVALID_OPERATION', first ? `${first.path.join('.')}：${first.message}` : undefined, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (parsed.data.pageId && parsed.data.pageId !== pageId) {
    throw new AppError('INVALID_OPERATION', 'transaction 的 pageId 與路徑不符');
  }

  const ops = parsed.data.ops.map((op) => normalizeOp(op as Operation));
  return {
    txId: parsed.data.txId,
    pageId,
    originSessionId: parsed.data.originSessionId,
    ops,
  };
}

/** 逐一套用 block type registry 的 props 驗證，並回填預設值 */
export function normalizeOp(op: Operation): Operation {
  switch (op.type) {
    case 'block.insert': {
      const def = getBlockType(op.blockType);
      const props = def.validateProps({ ...def.defaultProps, ...op.props });
      const content = def.hasInlineContent ? op.content : [];
      return { ...op, props, content };
    }
    case 'block.update': {
      if (op.patch.blockType !== undefined && op.patch.props !== undefined) {
        const def = getBlockType(op.patch.blockType);
        return { ...op, patch: { ...op.patch, props: def.validateProps(op.patch.props) } };
      }
      return op;
    }
    case 'text.delta':
      throw new AppError('NOT_IMPLEMENTED', 'text.delta 要等 M6 的自建 OT 才會啟用');
    default:
      return op;
  }
}

/**
 * 在 children 陣列中，把 blockId 插到 afterId 之後。
 * afterId = null → 插到最前面；afterId 不存在 → 附加到最後面。
 * 先移除既有的同 id（move 的語義），確保陣列內不會重複。
 */
export function spliceChildren(
  children: readonly string[],
  blockId: string,
  afterId: string | null,
): string[] {
  const next = children.filter((c) => c !== blockId);
  if (afterId === null) {
    next.unshift(blockId);
    return next;
  }
  const idx = next.indexOf(afterId);
  if (idx === -1) next.push(blockId);
  else next.splice(idx + 1, 0, blockId);
  return next;
}

export function removeChild(children: readonly string[], blockId: string): string[] {
  return children.filter((c) => c !== blockId);
}
