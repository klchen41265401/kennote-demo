-- ============================================================
-- 0030_block_deltas.sql
-- 為什麼：M6 第 4 項「Server receiveDelta + block_deltas 表 + rev 管理」
--         （04 §6.6.4、§8 M6；03 §8.4 Phase 3）。
--
-- 這是把協作從「block 粒度 LWW」升級成「自建簡化版 OT」唯一需要的 schema 變更。
-- 03 §8.4.3 早就把資料層鋪好了（rich text 用陣列、operations 有 base_version、
-- blocks.version 單調遞增），所以這裡只補兩樣東西：
--
--   1. blocks.rev —— 這個 block 的 **OT 版本號**。
--      刻意**不重用 blocks.version**：version 每次寫入都會 +1（含 props / type 變更），
--      而 rev 必須與 block_deltas 的列一一對應，否則 transform 的窗口查詢會取到洞。
--
--   2. block_deltas —— 每個 block 的 delta log。
--      transform 的窗口來源：`WHERE block_id = ? AND rev > baseRev ORDER BY rev`。
--      這是 03 §8.4.1「取出窗口內的已套用 op」那一步。
--
-- 與 page_transactions 的關係（重要，不要以為是兩套真值）：
--   真值永遠是 blocks.content。block_deltas 只是「為了 transform 而保留的窗口」，
--   page_transactions 仍然照舊每筆都寫（版本歷史 / 斷線補傳 / LWW 客戶端都靠它）。
--   text.delta 在 page_transactions.ops 裡是以「最終 content 的 block.update」記錄的，
--   所以 M8 的版本歷史重播完全不需要認識 OT。
--
-- 保留期：與 operations 相同的思路（03 §8.3）。所有客戶端都追上之後舊 delta 就沒用了；
-- 清理由 `DELETE FROM block_deltas WHERE applied_at < now() - interval '7 days'` 負責
-- （落後超過這個窗口的客戶端會收到 resync，重抓 snapshot）。
-- ============================================================

-- ------------------------------------------------------------
-- blocks.rev —— OT 版本號
-- ------------------------------------------------------------
ALTER TABLE blocks ADD COLUMN rev integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN blocks.rev IS
  'OT 版本號：套用過幾個 text.delta / 內容變更。與 block_deltas.rev 一一對應（04 §6.6.4）';

-- ------------------------------------------------------------
-- block_deltas —— 每個 block 的 delta log（transform 窗口）
-- ------------------------------------------------------------
CREATE TABLE block_deltas (
  block_id    uuid    NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  -- 套用這個 delta 之後 block 的 rev（第一個 delta 的 rev = 1）
  rev         integer NOT NULL,
  -- 已經 transform 到「rev-1 那一版」的 delta（廣播出去的就是這一份）
  delta       jsonb   NOT NULL,
  actor_id    uuid    REFERENCES users(id) ON DELETE SET NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (block_id, rev),
  CONSTRAINT chk_block_deltas_rev_positive CHECK (rev > 0),
  CONSTRAINT chk_block_deltas_delta_object CHECK (jsonb_typeof(delta) = 'object')
);

-- receiveDelta 的唯一查詢路徑：取 baseRev 之後的所有 delta，依 rev 排序
-- （PRIMARY KEY (block_id, rev) 已經涵蓋，這裡顯式加註，避免日後有人把主鍵順序改掉）
CREATE INDEX idx_block_deltas_window ON block_deltas (block_id, rev);

-- 保留期清理用
CREATE INDEX idx_block_deltas_applied_at ON block_deltas (applied_at);

-- ROLLBACK:
-- DROP TABLE IF EXISTS block_deltas;
-- ALTER TABLE blocks DROP COLUMN IF EXISTS rev;
