-- ============================================================
-- 0050_user_preferences.sql
-- 為什麼：設定頁的「我的設定」（語言 / 主題 / 開啟 kennote 時的起始頁面）要跟著帳號走，
--         換一台裝置登入也要是同一組偏好，所以不能只留在 localStorage。
--
-- 為什麼不塞進既有的 users.settings：
--   settings 是「伺服器端行為」的雜物袋（之後的通知偏好、實驗旗標都會進去），
--   preferences 則是**使用者自己在設定頁按出來的外觀偏好**，前端每次登入都會整包讀走。
--   兩者的讀寫頻率與擁有者不同，分欄位比較不會互踩（03 §3.2 的 jsonb 使用原則）。
--
-- 形狀（由 packages/shared-types 的 UserPreferences 定義，DB 只當作不透明 jsonb）：
--   { "locale": "zh-TW", "theme": "light" | "dark" | "system", "startPage": "home" | "last" }
-- 缺鍵 = 用預設值，因此舊的列不需要回填。
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 必須是 JSON 物件（不是陣列/純量），避免前端讀到奇怪的形狀
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_preferences;
ALTER TABLE users
  ADD CONSTRAINT chk_users_preferences CHECK (jsonb_typeof(preferences) = 'object');

-- ROLLBACK:
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_preferences;
-- ALTER TABLE users DROP COLUMN IF EXISTS preferences;
