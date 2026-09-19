-- ============================================================
-- 0003_collections.sql
-- 為什麼：Database 系統的定義層（collections = 欄位 schema、
--         collection_views = filter/sort/group + 外觀）。照 03 §4.6 / §4.7。
--
-- 「一列 = 一個頁面」的決定（03 §4.5、§4.6）：
--   database 的列**不另開表**，它就是 pages 的一列（parent_id 指向 database 頁面，
--   collection_id 指向 collection），欄位值存 pages.properties（03 §6.4 的格式）。
--   代價是 pages 表會混著文件頁與資料列；換來的是「列可以點開變成頁面、有子 block、
--   可被搜尋、可被 mention」這四件事完全不必寫第二套。
-- ============================================================

CREATE TABLE collections (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- 承載這個 collection 的頁面（pages.is_database = true）
  page_id       uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  name          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- RichText
  description   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- RichText
  -- key = propertyId（'title' 或 4~8 碼短碼），value = 欄位定義（shared-types 的 FieldDefinition）
  -- 短碼當穩定 id：使用者改欄位名稱時不必 rewrite 每一列（03 §4.6）
  schema        jsonb NOT NULL DEFAULT '{"title":{"name":"名稱","type":"title"}}'::jsonb,
  is_inline     boolean NOT NULL DEFAULT false,
  version       bigint NOT NULL DEFAULT 1,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT chk_collections_schema CHECK (
    jsonb_typeof(schema) = 'object' AND schema ? 'title'
  )
);

CREATE INDEX idx_collections_ws ON collections (workspace_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_collections_page ON collections (page_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_collections_schema_gin ON collections USING GIN (schema jsonb_path_ops);

CREATE TRIGGER collections_version BEFORE UPDATE ON collections
  FOR EACH ROW EXECUTE FUNCTION trg_bump_version();

-- ------------------------------------------------------------
-- pages 補上指向 collection 的欄位
--   is_database = true  → collection_id 指向「這一頁定義的」collection
--   is_database = false → collection_id 非 NULL 代表「這一頁是某個 database 的一列」
-- ------------------------------------------------------------
ALTER TABLE pages
  ADD COLUMN collection_id uuid REFERENCES collections(id) ON DELETE CASCADE;

-- database view 的主查詢：WHERE collection_id = ?
CREATE INDEX idx_pages_collection ON pages (collection_id, sort_key)
  WHERE collection_id IS NOT NULL AND deleted_at IS NULL;

-- ------------------------------------------------------------
-- collection_views —— 視圖獨立成表（03 §4.7）：
--   同一個 collection 可被多頁內嵌、各自不同視圖；query JSON 可能很大，
--   塞進頁面會拖慢每次載入。
-- ------------------------------------------------------------
CREATE TYPE collection_view_type AS ENUM ('table', 'board', 'list', 'gallery', 'calendar');

CREATE TABLE collection_views (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  type          collection_view_type NOT NULL DEFAULT 'table',
  name          text NOT NULL DEFAULT '預設檢視',
  -- filter / sort / group / 分頁（shared-types 的 ViewQuery）
  query         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 欄位顯示、寬度、行高…（shared-types 的 ViewFormat）
  format        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 手動排序模式時的列順序
  manual_order  uuid[] NOT NULL DEFAULT '{}',
  sort_order    integer NOT NULL DEFAULT 0,
  version       bigint NOT NULL DEFAULT 1,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX idx_views_collection ON collection_views (collection_id, sort_order)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_views_query_gin ON collection_views USING GIN (query jsonb_path_ops);

CREATE TRIGGER views_version BEFORE UPDATE ON collection_views
  FOR EACH ROW EXECUTE FUNCTION trg_bump_version();

-- ROLLBACK:
-- DROP TABLE IF EXISTS collection_views CASCADE;
-- DROP TYPE IF EXISTS collection_view_type;
-- ALTER TABLE pages DROP COLUMN IF EXISTS collection_id;
-- DROP TABLE IF EXISTS collections CASCADE;
