-- ============================================================
-- 0021_page_visits.sql
-- 為什麼：M6「最近瀏覽」（01 §8 M7.2.1 側邊欄最近分區、M7.1.8 搜尋建議）。
--
-- 這是**每人每頁一列**的 upsert，不是 append-only 的瀏覽日誌：
-- 01 §9 M8.3.1（頁面分析：瀏覽次數 / 瀏覽者）寫入量太大、需要獨立設計，
-- 這裡只解「搜尋框空狀態要顯示什麼」與「首頁的最近編輯」。
-- visit_count 順手累加，之後要做「常用頁面加權」時就不必再加一張表。
-- ============================================================

CREATE TABLE page_visits (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id      uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  -- 冗餘存 workspace_id：所有查詢都帶 workspace_id（03 §3.2 / §11.1）
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  visit_count  integer NOT NULL DEFAULT 1,
  visited_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page_id)
);

-- GET /api/recent?workspaceId= 的唯一查詢路徑
CREATE INDEX idx_page_visits_recent
  ON page_visits (user_id, workspace_id, visited_at DESC);

-- ROLLBACK:
-- DROP TABLE IF EXISTS page_visits;
