-- ------------------------------------------------------------
-- 0060_timeline_view —— collection_view_type 加上 'timeline'（時程表 / 甘特圖）
--
-- `0003_collections.sql` 把視圖型別做成 enum，所以新增一種視圖一定要動 schema。
-- PostgreSQL 12 以後 `ALTER TYPE ... ADD VALUE` 可以跑在交易裡（migrate.ts 是
-- 一支 migration 包一個 transaction），限制是**同一個交易內不能使用**新值 ——
-- 這支只加值、不寫資料，所以沒問題。
--
-- `IF NOT EXISTS` 讓重跑（或已手動補過）不會炸掉。
-- ------------------------------------------------------------
ALTER TYPE collection_view_type ADD VALUE IF NOT EXISTS 'timeline';

-- ROLLBACK:
-- PostgreSQL 無法從 enum 移除單一值；要還原必須重建型別：
--   ALTER TABLE collection_views ALTER COLUMN type TYPE text;
--   DROP TYPE collection_view_type;
--   CREATE TYPE collection_view_type AS ENUM ('table','board','list','gallery','calendar');
--   ALTER TABLE collection_views ALTER COLUMN type TYPE collection_view_type
--     USING type::collection_view_type;
