import type { BlockType } from '@kennote/shared-types';
import { z } from 'zod';
import { AppError } from '../../../lib/errors.js';

/**
 * 後端 Block Type Registry（04 §10.1）。
 * 一個 block 型別的「後端知識」（props 形狀、能不能有子節點、有沒有行內內容）
 * 全部集中在一個註冊項目裡。新增型別 = 加一行 defineBlockType()。
 *
 * 前端的 registry（渲染、slash menu、輸入捷徑、匯出）住在
 * apps/web/src/features/editor/blocks/，兩邊共用 shared-types 的 BlockType union。
 */
export interface ServerBlockType<P extends Record<string, unknown> = Record<string, unknown>> {
  type: BlockType;
  /** 驗證並正規化 props；不合法時丟 AppError('INVALID_BLOCK_PROPS') */
  validateProps(props: unknown): P;
  defaultProps: P;
  canHaveChildren: boolean;
  hasInlineContent: boolean;
}

const registry = new Map<BlockType, ServerBlockType>();

export function defineBlockType<S extends z.ZodType<Record<string, unknown>>>(spec: {
  type: BlockType;
  schema: S;
  defaultProps: z.infer<S>;
  canHaveChildren?: boolean;
  hasInlineContent?: boolean;
}): void {
  if (registry.has(spec.type)) throw new Error(`Block type 重複註冊: ${spec.type}`);
  registry.set(spec.type, {
    type: spec.type,
    defaultProps: spec.defaultProps,
    canHaveChildren: spec.canHaveChildren ?? true,
    hasInlineContent: spec.hasInlineContent ?? true,
    validateProps(props: unknown) {
      const parsed = spec.schema.safeParse(props ?? {});
      if (!parsed.success) {
        throw new AppError('INVALID_BLOCK_PROPS', `${spec.type} 的屬性格式不正確`, {
          blockType: spec.type,
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
      }
      return parsed.data;
    },
  });
}

export function getBlockType(type: string): ServerBlockType {
  const def = registry.get(type as BlockType);
  if (!def) throw new AppError('INVALID_BLOCK_TYPE', `不支援的區塊型別：${type}`, { type });
  return def;
}

export function hasBlockType(type: string): boolean {
  return registry.has(type as BlockType);
}

export function listBlockTypes(): ServerBlockType[] {
  return [...registry.values()];
}

/** 測試用 */
export function __resetBlockTypes(): void {
  registry.clear();
}
