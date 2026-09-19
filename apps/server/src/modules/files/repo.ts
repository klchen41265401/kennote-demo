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
  page_id: string | null;
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
    /** 這個附件屬於哪一頁（0070）。null = 不屬於任何頁面（頭像、匯入暫存） */
    pageId?: string | null;
  },
): Promise<FileRow> {
  const row = await conn.queryOne<FileRow>(sql`
    INSERT INTO files (id, workspace_id, storage_key, storage_driver, original_name,
                       content_type, size, uploaded_by, page_id)
    VALUES (${input.id}, ${input.workspaceId}, ${input.storageKey}, ${input.storageDriver},
            ${input.originalName}, ${input.contentType}, ${input.size}, ${input.uploadedBy},
            ${input.pageId ?? null})
    RETURNING id, workspace_id, storage_key, storage_driver, original_name,
              content_type, size, uploaded_by, page_id, created_at
  `);
  if (!row) throw new Error('寫入檔案紀錄失敗');
  return row;
}

/**
 * ⚠️ **這不是權限檢查**（第八輪 BUG-44 的教訓：`...ForUser` 這種名字害人）。
 * 它只回答「這個檔案在這個使用者所屬的工作區裡嗎」。
 * 依頁面權限的判斷在 `files/routes.ts` 的 `GET /:id`：
 *   `page_id` 有值 → `resolvePagePermission(read)`；沒有 → 才退回這一層。
 */
export async function findFileInUserWorkspace(
  fileId: string,
  userId: string,
): Promise<FileRow | null> {
  return db.queryOne<FileRow>(sql`
    SELECT f.id, f.workspace_id, f.storage_key, f.storage_driver, f.original_name,
           f.content_type, f.size, f.uploaded_by, f.page_id, f.created_at
      FROM files f
      JOIN workspace_members m
        ON m.workspace_id = f.workspace_id AND m.user_id = ${userId} AND m.deleted_at IS NULL
     WHERE f.id = ${fileId} AND f.deleted_at IS NULL
  `);
}
