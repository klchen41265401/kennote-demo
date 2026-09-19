-- ============================================================
-- 0006_database_m4.sql
-- 為什麼：M4 Database 系統（04 §8 M4 交付物 1）。0003 只建了定義層的骨架，
--         這一支補上「查詢得動、關聯得起來」需要的東西：
--           (1) relation 欄位的邊表（03 §4.8）
--           (2) collection / view 的內嵌掛點與外觀欄位（03 §4.6 / §4.7）
--           (3) 查詢路徑的索引：JSONB GIN、(collection_id, deleted_at) 與
--               keyset 分頁的 tie-break 索引（03 §7.3）
--
-- 與 03 §4.8 的差異（寫入 docs/adr/0003）：
--   03 的邊表叫 block_relations 且指向 blocks；本專案的 database 列是 **pages**
--   （ADR 0002 的 pages/blocks 分表決定），所以邊表改名 row_relations 並指向 pages。
--   欄位語意、唯一鍵、索引策略與 03 §4.8 完全一致。
-- ============================================================

-- ------------------------------------------------------------
-- collections：補內嵌掛點與外觀
--   parent_block_id：內嵌資料庫（collectionView block）掛在哪個 block 底下。
--   full-page database 為 NULL（真正的掛點是 collections.page_id）。
-- ------------------------------------------------------------
ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS parent_block_id uuid REFERENCES blocks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS icon            text,
  ADD COLUMN IF NOT EXISTS cover           text,
  ADD COLUMN IF NOT EXISTS template_pages  uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_collections_parent_block
  ON collections (parent_block_id) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- collection_views：內嵌視圖屬於哪個 block（同一個 collection 可被多頁內嵌，
-- 各自有不同視圖 —— 03 §4.7 之所以把視圖獨立成表的原因）
-- ------------------------------------------------------------
ALTER TABLE collection_views
  ADD COLUMN IF NOT EXISTS parent_block_id uuid REFERENCES blocks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_views_parent_block
  ON collection_views (parent_block_id) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- row_relations —— relation 屬性的邊表（03 §4.8 的 block_relations）
--
-- 真值（source of truth）是 pages.properties.<prop>.pageIds；
-- 這張表是**應用層在同一個交易內同步維護的投影**，只為了兩件事：
--   (1) 反向查詢（「哪些任務關聯到這個專案？」）不必掃 JSONB
--   (2) rollup 聚合可以直接 JOIN，不必 N+1
-- 絕不讓兩邊互相寫，否則一定漂移。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS row_relations (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- 來源列（= pages 的一列）
  from_row_id   uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  -- 來源列上的哪個 relation 欄位（propertyId）
  from_property text NOT NULL,
  -- 目標列
  to_row_id     uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  -- 目標 collection 上的反向欄位（雙向 relation 才有）
  to_property   text,
  position      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_row_relations UNIQUE (from_row_id, from_property, to_row_id)
);

CREATE INDEX IF NOT EXISTS idx_row_relations_forward
  ON row_relations (from_row_id, from_property, position);
CREATE INDEX IF NOT EXISTS idx_row_relations_reverse
  ON row_relations (to_row_id, to_property);
CREATE INDEX IF NOT EXISTS idx_row_relations_ws ON row_relations (workspace_id);

-- ------------------------------------------------------------
-- 查詢路徑的索引（03 §7.3）
--
-- 1000 筆 filter/sort 的目標是 < 50ms：
--   · 能用 @> 表達的條件（select is / multiSelect contains / person contains /
--     relation contains）吃 idx_pages_properties_gin（0002 已建，jsonb_path_ops）
--   · 其餘（數值、日期比較）掃 collection 內的列 —— 所以 collection 的
--     部分索引必須夠窄，見下面的 idx_pages_collection_alive
--   · keyset 分頁一定要有 id 當 tie-break（03 §7.3）
-- ------------------------------------------------------------

-- database view 的主掃描範圍：某個 collection 的未刪除列
CREATE INDEX IF NOT EXISTS idx_pages_collection_alive
  ON pages (collection_id, id)
  WHERE collection_id IS NOT NULL AND deleted_at IS NULL;

-- 預設排序（未設定 sort 時走 sort_key）與 keyset tie-break
CREATE INDEX IF NOT EXISTS idx_pages_collection_sortkey
  ON pages (collection_id, sort_key, id)
  WHERE collection_id IS NOT NULL AND deleted_at IS NULL;

-- createdTime / lastEditedTime 欄位的排序
CREATE INDEX IF NOT EXISTS idx_pages_collection_created
  ON pages (collection_id, created_at, id)
  WHERE collection_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pages_collection_updated
  ON pages (collection_id, updated_at DESC, id)
  WHERE collection_id IS NOT NULL AND deleted_at IS NULL;

-- 標題欄排序 / 視圖內搜尋（title contains）
CREATE INDEX IF NOT EXISTS idx_pages_collection_title
  ON pages (collection_id, title_plain, id)
  WHERE collection_id IS NOT NULL AND deleted_at IS NULL;

-- 垃圾桶：某個 collection 被軟刪除的列
CREATE INDEX IF NOT EXISTS idx_pages_collection_deleted
  ON pages (collection_id, deleted_at DESC)
  WHERE collection_id IS NOT NULL AND deleted_at IS NOT NULL;

-- 熱門欄位的表示式索引不預先全建（03 §7.3 的建議）：
--   數值／日期比較無法吃 jsonb_path_ops 的 GIN，只能靠表示式索引，
--   但欄位 id 是每個 collection 自己的短碼，無法寫成通用索引。
--   作法：查詢慢時，由維運針對該 collection 建一支，範本如下——
--     CREATE INDEX idx_<col>_due ON pages (((properties->'Dt99'->>'start')))
--       WHERE collection_id = '...' AND deleted_at IS NULL;

-- ROLLBACK:
-- DROP TABLE IF EXISTS row_relations CASCADE;
-- DROP INDEX IF EXISTS idx_pages_collection_alive, idx_pages_collection_sortkey,
--                      idx_pages_collection_created, idx_pages_collection_updated,
--                      idx_pages_collection_title, idx_pages_collection_deleted,
--                      idx_collections_parent_block, idx_views_parent_block;
-- ALTER TABLE collection_views DROP COLUMN IF EXISTS parent_block_id;
-- ALTER TABLE collections DROP COLUMN IF EXISTS parent_block_id,
--   DROP COLUMN IF EXISTS icon, DROP COLUMN IF EXISTS cover,
--   DROP COLUMN IF EXISTS template_pages;
