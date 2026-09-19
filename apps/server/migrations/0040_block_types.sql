-- 0040_block_types.sql
-- M2-C「`/` 斜線選單完整還原」：放寬 chk_blocks_type，補上 Notion 7.34 斜線選單
-- 需要的新 block 型別。
--
--   heading4     標題 4（Notion 7.34 新增第四層標題）
--   audio        音訊
--   pdf          PDF 預覽
--   breadcrumb   頁面路徑（麵包屑）
--   button       按鈕（可插入樣板 blocks / 開啟頁面）
--   syncedBlock  同步區塊（原始 + 引用）
--
-- 型別枚舉刻意用 text + CHECK（03 §3.2）：新增型別只要換一條約束，
-- 不需要 ALTER TYPE（在 Postgres 裡沒辦法在 transaction 裡安全地加 enum 值）。

ALTER TABLE blocks DROP CONSTRAINT IF EXISTS chk_blocks_type;

ALTER TABLE blocks ADD CONSTRAINT chk_blocks_type CHECK (type IN (
  'paragraph','heading1','heading2','heading3','heading4','bulletedList','numberedList',
  'todo','toggle','quote','callout','divider','code','image','file','bookmark',
  'equation','tableOfContents','page','columnList','column','table','tableRow',
  'collectionView','embed','video','audio','pdf','breadcrumb','button','syncedBlock'
));

-- ROLLBACK:
-- ALTER TABLE blocks DROP CONSTRAINT IF EXISTS chk_blocks_type;
-- ALTER TABLE blocks ADD CONSTRAINT chk_blocks_type CHECK (type IN (
--   'paragraph','heading1','heading2','heading3','bulletedList','numberedList',
--   'todo','toggle','quote','callout','divider','code','image','file','bookmark',
--   'equation','tableOfContents','page','columnList','column','table','tableRow',
--   'collectionView','embed','video'
-- ));
