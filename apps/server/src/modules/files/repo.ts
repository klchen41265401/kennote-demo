import { db, type Queryable } from '../../db/client.js';
import { sql } from '../../db/sql.js';

export interface FileRow {
  id: string;
  workspace_id: string;
  storage_key: string;
  storage_driver: string;
  original_name: string;
  content_type: string;
  size: number;
  uploaded_by: string | null;
  created_at: Date;
}

export async function insertFile(
  conn: Queryable,
  input: {
    id: string;
    workspaceId: string;
    storageKey: string;
    storageDriver: string;
    originalName: string;
    contentType: string;
    size: number;
    uploadedBy: string;
  },
): Promise<FileRow> {
  const row = await conn.queryOne<FileRow>(sql`
    INSERT INTO files (id, workspace_id, storage_key, storage_driver, original_name,
                       content_type, size, uploaded_by)
    VALUES (${input.id}, ${input.workspaceId}, ${input.storageKey}, ${input.storageDriver},
            ${input.originalName}, ${input.contentType}, ${input.size}, ${input.uploadedBy})
    RETURNING id, workspace_id, storage_key, storage_driver, original_name,
              content_type, size, uploaded_by, created_at
  `);
  if (!row) throw new Error('寫入檔案紀錄失敗');
  return row;
}

/**
 * 取檔案 **並檢查權限**。
 * 04 §5.6：「檔案存取必須經過權限檢查，不可用『網址猜不到』當保護」。
 */
export async function findFileForUser(fileId: string, userId: string): Promise<FileRow | null> {
  return db.queryOne<FileRow>(sql`
    SELECT f.id, f.workspace_id, f.storage_key, f.storage_driver, f.original_name,
           f.content_type, f.size, f.uploaded_by, f.created_at
      FROM files f
      JOIN workspace_members m
        ON m.workspace_id = f.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
     WHERE f.id = ${fileId} AND f.deleted_at IS NULL
  `);
}
