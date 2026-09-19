-- ============================================================
-- 0005_search.sql
-- 為什麼：自建搜尋（03 §7.4、01 §7）。不引入 Meilisearch / Elasticsearch。
--
-- 這一支只做「第一階段」：pg_trgm + GIN 的 ILIKE 子字串搜尋。
--   理由：PostgreSQL 預設的 tsvector parser 不會斷中文，直接上 to_tsvector('simple')
--   對中文等於沒用；trgm 對中文子字串反而立刻有效、不需要任何 DB 端擴充套件。
--   第二階段（應用層中文斷詞 → search_text → tsvector + ts_rank_cd）排在 M6，
--   屆時只要再加一支 migration 補 search_text / search_tsv 欄位，
--   本階段的查詢路徑不受影響。
--
-- plain_text 用 generated column：永遠與 content/title 同步，
-- 應用層忘了更新也不會有髒資料。
-- ============================================================

-- RichText（InlineNode[]）→ 純文字。必須 IMMUTABLE 才能給 generated column 用。
CREATE OR REPLACE FUNCTION kn_richtext_plain(rt jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT coalesce(
    (SELECT string_agg(node->>'text', '' ORDER BY ord)
       FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(rt) = 'array' THEN rt ELSE '[]'::jsonb END
            ) WITH ORDINALITY AS t(node, ord)
      WHERE jsonb_typeof(node) = 'object' AND node ? 'text'),
    ''
  );
$fn$;

ALTER TABLE blocks
  ADD COLUMN plain_text text
  GENERATED ALWAYS AS (left(kn_richtext_plain(content), 100000)) STORED;

ALTER TABLE pages
  ADD COLUMN title_plain text
  GENERATED ALWAYS AS (left(kn_richtext_plain(title), 2000)) STORED;

-- 中文子字串搜尋（trgm 對 CJK 一樣有效，因為它切 3-gram 不看語言）
CREATE INDEX idx_blocks_plain_text_trgm
  ON blocks USING GIN (plain_text gin_trgm_ops)
  WHERE deleted_at IS NULL AND plain_text <> '';

CREATE INDEX idx_pages_title_trgm
  ON pages USING GIN (title_plain gin_trgm_ops)
  WHERE deleted_at IS NULL AND title_plain <> '';

-- ILIKE '%foo%' 也能吃到上面的 GIN trgm 索引（PostgreSQL 9.1+）
-- 驗證方式：EXPLAIN SELECT ... WHERE plain_text ILIKE '%關鍵字%';

-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_pages_title_trgm, idx_blocks_plain_text_trgm;
-- ALTER TABLE pages DROP COLUMN IF EXISTS title_plain;
-- ALTER TABLE blocks DROP COLUMN IF EXISTS plain_text;
-- DROP FUNCTION IF EXISTS kn_richtext_plain(jsonb);
