import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { getBlockType, hasBlockType, listBlockTypes } from '../src/modules/blocks/block-types/index.js';
import { BLOCK_TYPES } from '@kennote/shared-types';

describe('block type registry', () => {
  it('shared-types 的每個 BlockType 都有對應的後端定義（不會漏註冊）', () => {
    for (const type of BLOCK_TYPES) {
      expect(hasBlockType(type), `缺少 ${type} 的註冊`).toBe(true);
    }
    expect(listBlockTypes()).toHaveLength(BLOCK_TYPES.length);
  });

  it('未知型別丟 INVALID_BLOCK_TYPE', () => {
    try {
      getBlockType('rating');
      throw new Error('應該要丟錯');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('INVALID_BLOCK_TYPE');
      expect((err as AppError).statusCode).toBe(400);
    }
  });

  it('todo 的 checked 會被正規化成 boolean', () => {
    expect(getBlockType('todo').validateProps({})).toEqual({ checked: false });
    expect(getBlockType('todo').validateProps({ checked: true })).toEqual({ checked: true });
  });

  it('多餘的 props 會被拒絕（strict schema）', () => {
    expect(() => getBlockType('paragraph').validateProps({ nope: 1 })).toThrow(AppError);
  });

  it('型別錯誤的 props 會被拒絕', () => {
    expect(() => getBlockType('todo').validateProps({ checked: 'yes' })).toThrow(AppError);
    expect(() => getBlockType('column').validateProps({ ratio: 5 })).toThrow(AppError);
  });

  it('能力宣告正確（divider 不能有子節點也沒有行內內容）', () => {
    const divider = getBlockType('divider');
    expect(divider.canHaveChildren).toBe(false);
    expect(divider.hasInlineContent).toBe(false);
    const paragraph = getBlockType('paragraph');
    expect(paragraph.canHaveChildren).toBe(true);
    expect(paragraph.hasInlineContent).toBe(true);
  });

  it('code 的預設語言是 plain', () => {
    expect(getBlockType('code').validateProps({})).toMatchObject({ language: 'plain' });
  });

  /* ── M2-C：斜線選單補上的型別 ─────────────────────── */

  it('標題 1~4 都能收合（toggleable + collapsed）', () => {
    for (const type of ['heading1', 'heading2', 'heading3', 'heading4'] as const) {
      expect(getBlockType(type).validateProps({ toggleable: true, collapsed: true })).toEqual({
        toggleable: true,
        collapsed: true,
      });
    }
  });

  it('audio / pdf 走媒體 schema（fileId 或 externalUrl 二擇一）', () => {
    expect(getBlockType('audio').validateProps({ externalUrl: 'https://a/b.mp3' })).toMatchObject({
      externalUrl: 'https://a/b.mp3',
    });
    expect(getBlockType('pdf').validateProps({ name: 'a.pdf', size: 10 })).toMatchObject({ name: 'a.pdf' });
    expect(() => getBlockType('audio').validateProps({ fileId: 'not-a-uuid' })).toThrow(AppError);
  });

  it('breadcrumb 沒有可調整的 props（只有顏色）', () => {
    expect(getBlockType('breadcrumb').validateProps({})).toEqual({});
    expect(() => getBlockType('breadcrumb').validateProps({ depth: 3 })).toThrow(AppError);
  });

  it('button：預設標籤是「按鈕」，actions 會被驗證', () => {
    expect(getBlockType('button').validateProps({})).toEqual({ label: '按鈕', actions: [] });
    const ok = getBlockType('button').validateProps({
      label: '新增任務',
      actions: [{ type: 'insertBlocks', blocks: [{ type: 'todo', props: { checked: false } }] }],
    });
    expect(ok).toMatchObject({ label: '新增任務' });
    expect(() => getBlockType('button').validateProps({ actions: [{ type: 'nope' }] })).toThrow(AppError);
  });

  it('button 的樣板巢狀有深度上限（防惡意 payload）', () => {
    const deep = (depth: number): Record<string, unknown> =>
      depth === 0 ? { type: 'paragraph' } : { type: 'toggle', children: [deep(depth - 1)] };
    expect(() =>
      getBlockType('button').validateProps({ actions: [{ type: 'insertBlocks', blocks: [deep(8)] }] }),
    ).toThrow(AppError);
  });

  it('syncedBlock：syncedFrom 預設為 null（= 原始區塊），可以有子節點', () => {
    expect(getBlockType('syncedBlock').validateProps({})).toEqual({ syncedFrom: null });
    expect(getBlockType('syncedBlock').canHaveChildren).toBe(true);
    expect(() => getBlockType('syncedBlock').validateProps({ syncedFrom: 'x' })).toThrow(AppError);
  });
});

describe('migration 0040：chk_blocks_type 與 BLOCK_TYPES 一致', () => {
  it('每個 BLOCK_TYPES 的字串都出現在最新的 CHECK 約束裡', async () => {
    const fs = await import('node:fs/promises');
    const url = await import('node:url');
    const path = await import('node:path');
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const sql = await fs.readFile(path.join(dir, '../migrations/0040_block_types.sql'), 'utf8');
    // 只看 ROLLBACK 之前的段落（後面那份是舊的約束）
    const active = sql.split('-- ROLLBACK:')[0] ?? '';
    for (const type of BLOCK_TYPES) {
      expect(active.includes(`'${type}'`), `chk_blocks_type 缺少 ${type}`).toBe(true);
    }
  });
});
