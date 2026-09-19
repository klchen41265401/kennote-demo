-- ============================================================
-- 0020_search_tsvector.sql
-- 為什麼：M6 搜尋第二階段（03 §7.4、01 §8.1、04 §8 M6 第 6 項）。
--
-- 0005 只做了 pg_trgm + ILIKE，能用但**無法排序相關性**、長查詢慢。
-- 這一支補上 tsvector + GIN 與 ts_rank_cd 排序，trgm 索引全部保留當 fallback
-- （短查詢 1~2 字、錯字、沒斷出來的詞）。查詢路徑二選一由應用層決定。
--
-- ⭐ 關鍵取捨：PostgreSQL 預設 parser 不會斷中文（'資料庫設計' 是一個 token），
--    所以 to_tsvector 前一定要先斷詞。03 §7.4 方案 A（應用層斷詞）的問題是
--    「索引端」也得在應用層算 —— 而 blocks 的寫入路徑只有 applyTransaction，
--    漏算就是髒索引。
--
--    本專案的做法：把**同一套斷詞規則**寫成 IMMUTABLE 的 SQL 函式 kn_segment()，
--    索引端用 generated column（永遠不會髒），查詢端用 TypeScript 的
--    apps/server/src/modules/search/segment.ts（同一套規則，有單元測試對齊）。
--    兩邊規則若漂移，segment.test.ts 的黃金案例會先炸掉。
--
--    斷詞規則（故意極簡，才能在兩種語言裡寫成一樣）：
--      · [0-9A-Za-z]+ 連續英數 → 小寫後當一個 token
--      · CJK 連續字元 → 長度 1 給該字；長度 ≥ 2 給所有 bigram
--        （'資料庫' → '資料' '料庫'；查詢端用同一規則，所以天然對齊）
--      · 其餘字元一律視為分隔符
-- ============================================================

-- ------------------------------------------------------------
-- kn_segment：斷詞。必須 IMMUTABLE 才能給 generated column 用。
--   單趟 regexp 掃描（英數 run 或 CJK run），順序與原文一致，
--   ts_rank_cd 的 cover density 才有意義。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION kn_segment(txt text) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $fn$
DECLARE
  -- 中日韓統一表意文字 + 擴充 A + 相容表意 + 假名 + 諺文
  cjk   constant text := '[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]';
  parts text[] := ARRAY[]::text[];
  m     text[];
  run   text;
  n     int;
  i     int;
BEGIN
  IF txt IS NULL OR txt = '' THEN
    RETURN '';
  END IF;

  FOR m IN
    SELECT regexp_matches(txt, '([0-9A-Za-z]+)|(' || cjk || '+)', 'g')
  LOOP
    IF m[1] IS NOT NULL THEN
      parts := parts || lower(m[1]);
    ELSE
      run := m[2];
      n := char_length(run);
      IF n = 1 THEN
        parts := parts || run;
      ELSE
        FOR i IN 1..(n - 1) LOOP
          parts := parts || substr(run, i, 2);
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  RETURN array_to_string(parts, ' ');
END;
$fn$;

COMMENT ON FUNCTION kn_segment(text) IS
  '中文斷詞（CJK bigram + 英數詞）。必須與 modules/search/segment.ts 完全一致。';

-- ------------------------------------------------------------
-- kn_row_props_plain：database 列的屬性值 → 純文字（01 §8 M7.1.7）。
--   只取「人看得到的值」，刻意不做遞迴（FieldValue 的形狀是固定的，
--   見 packages/shared-types/src/database.ts）。
--   已知限制：select / multiSelect 存的是 optionId，選項標籤在 collection
--   的 schema 裡，這裡展不開 —— 寫進 ADR 0005，之後靠 search_documents 聚合表解。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION kn_row_props_plain(props jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT coalesce(string_agg(part, ' '), '')
    FROM (
      SELECT concat_ws(
               ' ',
               v.value ->> 'plainText',
               v.value ->> 'url',
               v.value ->> 'email',
               v.value ->> 'phone',
               v.value ->> 'start',
               v.value ->> 'optionId',
               CASE WHEN jsonb_typeof(v.value -> 'number') = 'number'
                    THEN v.value ->> 'number' END,
               CASE WHEN jsonb_typeof(v.value -> 'value') IN ('string', 'number')
                    THEN v.value ->> 'value' END,
               CASE WHEN jsonb_typeof(v.value -> 'optionIds') = 'array'
                    THEN (SELECT string_agg(x #>> '{}', ' ')
                            FROM jsonb_array_elements(v.value -> 'optionIds') x
                           WHERE jsonb_typeof(x) = 'string') END,
               CASE WHEN jsonb_typeof(v.value -> 'files') = 'array'
                    THEN (SELECT string_agg(f ->> 'name', ' ')
                            FROM jsonb_array_elements(v.value -> 'files') f
                           WHERE jsonb_typeof(f) = 'object') END
             ) AS part
        FROM jsonb_each(
               CASE WHEN jsonb_typeof(props) = 'object' THEN props ELSE '{}'::jsonb END
             ) v
       WHERE jsonb_typeof(v.value) = 'object'
    ) t
   WHERE part IS NOT NULL AND part <> '';
$fn$;

-- ------------------------------------------------------------
-- blocks.search_tsv
--   ⚠️ generated column 不能引用另一個 generated column，
--      所以這裡重算 kn_richtext_plain(content) 而不是用 plain_text。
--   內文截到 20000 字：超長 block（貼上整本書）不該讓一次編輯付出無上限的索引成本。
-- ------------------------------------------------------------
ALTER TABLE blocks
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', kn_segment(left(kn_richtext_plain(content), 20000)))
  ) STORED;

CREATE INDEX idx_blocks_search_tsv ON blocks USING GIN (search_tsv)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- pages.search_tsv —— 標題權重 A、屬性值權重 B（03 §7.4 的 setweight 分層）
-- ------------------------------------------------------------
ALTER TABLE pages
  ADD COLUMN props_plain text
  GENERATED ALWAYS AS (left(kn_row_props_plain(properties), 8000)) STORED;

ALTER TABLE pages
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', kn_segment(left(kn_richtext_plain(title), 2000))), 'A') ||
    setweight(to_tsvector('simple', kn_segment(left(kn_row_props_plain(properties), 8000))), 'B')
  ) STORED;

CREATE INDEX idx_pages_search_tsv ON pages USING GIN (search_tsv)
  WHERE deleted_at IS NULL;

-- 屬性值的 trgm fallback（短查詢）
CREATE INDEX idx_pages_props_plain_trgm ON pages USING GIN (props_plain gin_trgm_ops)
  WHERE deleted_at IS NULL AND props_plain <> '';

-- 篩選：createdBy / updatedAfter（搜尋的 filter 面板）
CREATE INDEX idx_pages_ws_created_by ON pages (workspace_id, created_by, updated_at DESC)
  WHERE deleted_at IS NULL;

-- ROLLBACK:
-- DROP INDEX IF EXISTS idx_pages_ws_created_by, idx_pages_props_plain_trgm,
--                      idx_pages_search_tsv, idx_blocks_search_tsv;
-- ALTER TABLE pages DROP COLUMN IF EXISTS search_tsv, DROP COLUMN IF EXISTS props_plain;
-- ALTER TABLE blocks DROP COLUMN IF EXISTS search_tsv;
-- DROP FUNCTION IF EXISTS kn_row_props_plain(jsonb);
-- DROP FUNCTION IF EXISTS kn_segment(text);
