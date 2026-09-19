-- ============================================================
-- 0070_files_page.sql
-- 為什麼：第八輪 §4-1 的已知缺口 —— `GET /api/files/:id` 只做到
--         「工作區成員限定」，同工作區的 guest 拿得到私密頁面裡的附件。
--
-- 附件與頁面之間原本只有 `block.props.fileId` 這條「反查」關係，
-- 要依頁面權限擋就得先有正向的 `file → page`。上傳當下最知道
-- 「這個檔案要放進哪一頁」，所以把它記在 files 上。
--
-- 可為 NULL：
--   1. 既有資料一律是 NULL（不回填 —— 反查 block.props 在大工作區太慢，
--      而且頭像 / 匯入暫存檔本來就不屬於任何頁面）
--   2. 頭像（AccountPanel）永遠不帶 pageId
--   NULL 的退路仍是「工作區成員限定」，與這一輪之前的行為相同。
--
-- ON DELETE SET NULL：頁面被永久刪除時附件列不要跟著消失
-- （GC 的孤兒回收負責清它，見 modules/gc/service.ts）。
-- ============================================================

ALTER TABLE files ADD COLUMN page_id uuid REFERENCES pages(id) ON DELETE SET NULL;

-- 「這一頁有哪些附件」（匯出打包、頁面刪除後的孤兒盤點）
CREATE INDEX idx_files_page ON files (page_id) WHERE page_id IS NOT NULL AND deleted_at IS NULL;
