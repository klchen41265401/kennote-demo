import type { Block, BlockType, RichText } from '@kennote/shared-types';
import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';

export interface BlockRow {
  id: string;
  workspace_id: string;
  page_id: string;
  parent_id: string | null;
  type: BlockType;
  props: Record<string, unknown>;
  content: RichText;
  children: string[];
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const BLOCK_COLUMNS = sql.raw(
  'id, workspace_id, page_id, parent_id, type, props, content, children, version, ' +
    'created_by, updated_by, created_at, updated_at, deleted_at',
);

export function toBlock(row: BlockRow): Block {
  return {
    id: row.id,
    pageId: row.page_id,
    parentId: row.parent_id,
    type: row.type,
    props: (row.props ?? {}) as Block['props'],
    content: row.content ?? [],
    children: row.children ?? [],
    version: Number(row.version),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export async function listBlocksByPage(
  pageId: string,
  conn: Queryable = db,
): Promise<BlockRow[]> {
  return conn.query<BlockRow>(sql`
    SELECT ${BLOCK_COLUMNS} FROM blocks
     WHERE page_id = ${pageId} AND deleted_at IS NULL
     ORDER BY created_at ASC
  `);
}

export async function findBlock(id: string, conn: Queryable = db): Promise<BlockRow | null> {
  return conn.queryOne<BlockRow>(sql`
    SELECT ${BLOCK_COLUMNS} FROM blocks WHERE id = ${id} AND deleted_at IS NULL
  `);
}

export async function findBlocks(ids: string[], conn: Queryable = db): Promise<BlockRow[]> {
  if (ids.length === 0) return [];
  return conn.query<BlockRow>(sql`
    SELECT ${BLOCK_COLUMNS} FROM blocks
     WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
  `);
}

export async function insertBlock(
  conn: Queryable,
  input: {
    id: string;
    workspaceId: string;
    pageId: string;
    parentId: string | null;
    type: BlockType;
    props: Record<string, unknown>;
    content: RichText;
    actorId: string;
  },
): Promise<BlockRow> {
  const row = await conn.queryOne<BlockRow>(sql`
    INSERT INTO blocks (id, workspace_id, page_id, parent_id, type, props, content,
                        created_by, updated_by)
    VALUES (${input.id}, ${input.workspaceId}, ${input.pageId}, ${input.parentId},
            ${input.type}, ${JSON.stringify(input.props)}::jsonb,
            ${JSON.stringify(input.content)}::jsonb, ${input.actorId}, ${input.actorId})
    RETURNING ${BLOCK_COLUMNS}
  `);
  if (!row) throw new Error('建立 block 失敗');
  return row;
}

export async function updateBlockRow(
  conn: Queryable,
  id: string,
  patch: { type?: BlockType; props?: Record<string, unknown>; content?: RichText },
  actorId: string,
): Promise<BlockRow | null> {
  const sets = [sql`updated_by = ${actorId}`, sql`version = version + 1`];
  if (patch.type !== undefined) sets.push(sql`type = ${patch.type}`);
  if (patch.props !== undefined) sets.push(sql`props = ${JSON.stringify(patch.props)}::jsonb`);
  if (patch.content !== undefined)
    sets.push(sql`content = ${JSON.stringify(patch.content)}::jsonb`);
  return conn.queryOne<BlockRow>(sql`
    UPDATE blocks SET ${sql.join(sets, ', ')}
     WHERE id = ${id} AND deleted_at IS NULL
     RETURNING ${BLOCK_COLUMNS}
  `);
}

export async function setBlockParent(
  conn: Queryable,
  id: string,
  parentId: string | null,
  actorId: string,
): Promise<void> {
  await conn.query(sql`
    UPDATE blocks SET parent_id = ${parentId}, updated_by = ${actorId}, version = version + 1
     WHERE id = ${id}
  `);
}

export async function setBlockChildren(
  conn: Queryable,
  id: string,
  children: string[],
): Promise<void> {
  await conn.query(sql`
    UPDATE blocks SET children = ${children}::uuid[] WHERE id = ${id}
  `);
}

/** 取整棵 block 子樹的 id（含自己） */
export async function collectBlockDescendants(
  conn: Queryable,
  blockId: string,
): Promise<string[]> {
  const rows = await conn.query<{ id: string }>(sql`
    WITH RECURSIVE sub AS (
      SELECT id, 0 AS depth FROM blocks WHERE id = ${blockId} AND deleted_at IS NULL
      UNION ALL
      SELECT b.id, sub.depth + 1 FROM blocks b JOIN sub ON b.parent_id = sub.id
       WHERE b.deleted_at IS NULL AND sub.depth < 50
    )
    SELECT id FROM sub
  `);
  return rows.map((r) => r.id);
}

export async function softDeleteBlocks(
  conn: Queryable,
  ids: string[],
  actorId: string,
): Promise<void> {
  if (ids.length === 0) return;
  await conn.query(sql`
    UPDATE blocks SET deleted_at = now(), updated_by = ${actorId}
     WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL
  `);
}

/** block.move 的循環檢測：candidateParent 是不是 blockId 的子孫（或自己） */
export async function isBlockDescendantOf(
  conn: Queryable,
  candidateParentId: string,
  blockId: string,
): Promise<boolean> {
  if (candidateParentId === blockId) return true;
  const row = await conn.queryOne<{ found: boolean }>(sql`
    WITH RECURSIVE up AS (
      SELECT id, parent_id, 0 AS depth FROM blocks WHERE id = ${candidateParentId}
      UNION ALL
      SELECT b.id, b.parent_id, up.depth + 1 FROM blocks b JOIN up ON b.id = up.parent_id
       WHERE up.depth < 50
    )
    SELECT EXISTS (SELECT 1 FROM up WHERE id = ${blockId}) AS found
  `);
  return row?.found ?? false;
}
