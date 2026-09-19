-- ============================================================
-- 0002_pages_blocks.sql
-- 為什麼：頁面樹（pages）、頁面內容（blocks）、以及整個系統最關鍵的資產
--         page_transactions —— 它同時支撐斷線補傳、版本歷史、協作 undo 的
--         transform 來源與稽核日誌（04 §5.4）。
--
-- 與 03 §4.5 的差異（已寫入 docs/adr/0002）：
--   03 主張「沒有 pages 表，頁面就是 blocks WHERE type='page'」。
--   本專案改成 pages / blocks 兩張表，理由：
--     (1) 04 §5.4 的 operation 模型本來就以 pageId 當作鎖與 seq 的單位，
--         pages 需要 seq 欄位做 SELECT ... FOR UPDATE 的序列化點；
--     (2) 側邊欄樹查詢（遞迴 CTE）只掃 pages，不必在千萬筆 block 裡過濾 type；
--     (3) 兩張表都保留 workspace_id、軟刪除、version，資料模型的「一切皆 block」
--         精神（真值在 blocks、排序真值在父節點的 children 陣列）完全保留。
-- ============================================================

CREATE TABLE pages (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- NULL = 工作區頂層頁面
  parent_id     uuid REFERENCES pages(id) ON DELETE CASCADE,
  -- RichText（04 §4.2 的扁平 InlineSpan 陣列）
  title         jsonb NOT NULL DEFAULT '[]'::jsonb,
  icon          text,
  cover         text,
  -- 自研 fractional index。COLLATE "C" 確保排序是位元組字典序，
  -- 不受資料庫 locale 影響（否則 'A' 與 'a' 的相對順序會跟前端算的不一樣）
  sort_key      text COLLATE "C" NOT NULL DEFAULT 'V',
  -- 根層 block 的順序（排序唯一真值，03 §5.1 方案 A）
  children      uuid[] NOT NULL DEFAULT '{}',
  is_database   boolean NOT NULL DEFAULT false,
  -- database row 的欄位值（03 §6.4）；一般頁面為 {}
  properties    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 頁面層級 transaction 序號（單調遞增，client 用來偵測漏收）
  seq           bigint NOT NULL DEFAULT 0,
  version       bigint NOT NULL DEFAULT 1,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT chk_pages_title_array CHECK (jsonb_typeof(title) = 'array'),
  CONSTRAINT chk_pages_props_object CHECK (jsonb_typeof(properties) = 'object'),
  CONSTRAINT chk_pages_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

-- 側邊欄：某個 parent 底下的子頁面，依 sort_key 排
CREATE INDEX idx_pages_parent ON pages (parent_id, sort_key) WHERE deleted_at IS NULL;
-- 工作區頂層頁面
CREATE INDEX idx_pages_top_level ON pages (workspace_id, sort_key)
  WHERE parent_id IS NULL AND deleted_at IS NULL;
-- 最近編輯 / 增量同步
CREATE INDEX idx_pages_ws_updated ON pages (workspace_id, updated_at DESC) WHERE deleted_at IS NULL;
-- 垃圾桶列表
CREATE INDEX idx_pages_trash ON pages (workspace_id, deleted_at DESC) WHERE deleted_at IS NOT NULL;
-- database row 的欄位值容器查詢
CREATE INDEX idx_pages_properties_gin ON pages USING GIN (properties jsonb_path_ops);

-- pages 的 updated_at 由應用層在 transaction 內控制（要跟 seq 一起動），
-- 這裡只補一個保險的 updated_at 觸發器，不動 version。
CREATE TRIGGER pages_updated_at BEFORE UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ------------------------------------------------------------
-- blocks —— 系統的心臟。真值來源自始至終都是這張表（03 §2.1）
-- 排序真值 = 父節點（block 或 page）的 children 陣列
-- ------------------------------------------------------------
CREATE TABLE blocks (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  -- NULL = 直接掛在頁面根層（順序由 pages.children 決定）
  parent_id     uuid REFERENCES blocks(id) ON DELETE CASCADE,
  type          text NOT NULL,
  -- 內容 + 外觀資料（04 §5.4 的 props；03 把它拆成 properties/format，
  -- 本專案合併成單一 props，理由見 docs/adr/0002）
  props         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 行內內容：RichText = InlineNode[]
  content       jsonb NOT NULL DEFAULT '[]'::jsonb,
  children      uuid[] NOT NULL DEFAULT '{}',
  version       bigint NOT NULL DEFAULT 1,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT chk_blocks_content_array CHECK (jsonb_typeof(content) = 'array'),
  CONSTRAINT chk_blocks_props_object CHECK (jsonb_typeof(props) = 'object'),
  CONSTRAINT chk_blocks_no_self_parent CHECK (parent_id IS NULL OR parent_id <> id),
  -- 會頻繁增值的枚舉用 text + CHECK（03 §3.2）。新增 block 型別 = 改這條約束。
  CONSTRAINT chk_blocks_type CHECK (type IN (
    'paragraph','heading1','heading2','heading3','bulletedList','numberedList',
    'todo','toggle','quote','callout','divider','code','image','file','bookmark',
    'equation','tableOfContents','page','columnList','column','table','tableRow',
    'collectionView','embed','video'
  ))
);

-- 最高頻查詢：載入一頁的所有 block
CREATE INDEX idx_blocks_page ON blocks (page_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_blocks_parent ON blocks (parent_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_blocks_ws_type ON blocks (workspace_id, type) WHERE deleted_at IS NULL;
-- 反查「我出現在哪個 children 裡」（修樹、孤兒偵測）
CREATE INDEX idx_blocks_children_gin ON blocks USING GIN (children);
CREATE INDEX idx_blocks_props_gin ON blocks USING GIN (props jsonb_path_ops);

CREATE TRIGGER blocks_updated_at BEFORE UPDATE ON blocks
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ------------------------------------------------------------
-- page_transactions —— append-only 的 operation log
-- 冪等：tx_id 是主鍵，重送直接回 result
-- 序列化：(page_id, seq) 唯一，seq 由 pages.seq 在 FOR UPDATE 之下遞增
-- ------------------------------------------------------------
CREATE TABLE page_transactions (
  tx_id             uuid PRIMARY KEY,
  page_id           uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  seq               bigint NOT NULL,
  ops               jsonb NOT NULL,
  -- 冪等重送時原封不動回傳上次的 TransactionResult
  result            jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  origin_session_id text,
  applied_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_page_tx_seq UNIQUE (page_id, seq),
  CONSTRAINT chk_page_tx_ops_array CHECK (jsonb_typeof(ops) = 'array')
);

-- 斷線補傳：GET /api/pages/:id/transactions?since=N
CREATE INDEX idx_page_tx_since ON page_transactions (page_id, seq);
CREATE INDEX idx_page_tx_actor ON page_transactions (actor_id, applied_at DESC);

-- ROLLBACK:
-- DROP TABLE IF EXISTS page_transactions, blocks, pages CASCADE;
