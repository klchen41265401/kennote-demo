-- ============================================================
-- 0004_files_favorites.sql
-- 為什麼：M2-B 的圖片/檔案 block 需要 files；M3 的我的最愛需要 favorites；
--         page_permissions 先放最小版（04 §10.4 的權限引擎擴充點），
--         MVP 階段實際生效的仍是 workspace 成員檢查，但表先在，
--         之後補「頁面層授權」不必動既有查詢的形狀。
-- ============================================================

CREATE TABLE files (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- 儲存 key：{workspaceId}/{yyyy}/{mm}/{uuid}.{ext}
  -- 絕不用使用者檔名當路徑（防 path traversal，04 §5.6）
  storage_key    text NOT NULL,
  storage_driver text NOT NULL DEFAULT 'local',
  -- 使用者原始檔名只存這裡，下載時用 Content-Disposition 帶回
  original_name  text NOT NULL,
  -- 以 magic number 驗證過的真實 MIME，不信任 client 的 Content-Type
  content_type   text NOT NULL,
  size           bigint NOT NULL,
  checksum       text,
  uploaded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT uq_files_storage_key UNIQUE (storage_key),
  CONSTRAINT chk_files_size CHECK (size >= 0)
);

CREATE INDEX idx_files_ws ON files (workspace_id, created_at DESC) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------
-- favorites —— 我的最愛 / 釘選（M3）
-- ------------------------------------------------------------
CREATE TABLE favorites (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id      uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sort_key     text COLLATE "C" NOT NULL DEFAULT 'V',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page_id)
);

CREATE INDEX idx_favorites_user ON favorites (user_id, workspace_id, sort_key);

-- ------------------------------------------------------------
-- page_permissions —— 權限繼承模型的最小版（03 §4.12）
--   一筆 = 「某個頁面對某個主體（user / workspace / public）的授權」
--   inherits = false 的頁面是權限中斷點，解析時往上找到第一個中斷點為止
-- ------------------------------------------------------------
CREATE TYPE page_role AS ENUM ('owner', 'editor', 'commenter', 'reader', 'none');
CREATE TYPE permission_subject AS ENUM ('user', 'workspace', 'public');

CREATE TABLE page_permissions (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id      uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  subject_type permission_subject NOT NULL,
  -- subject_type='user' → users.id；'workspace' → workspaces.id；'public' → NULL
  subject_id   uuid,
  role         page_role NOT NULL DEFAULT 'reader',
  granted_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_page_permissions UNIQUE (page_id, subject_type, subject_id),
  CONSTRAINT chk_page_permissions_subject CHECK (
    (subject_type = 'public' AND subject_id IS NULL) OR
    (subject_type <> 'public' AND subject_id IS NOT NULL)
  )
);

CREATE INDEX idx_page_permissions_page ON page_permissions (page_id);
CREATE INDEX idx_page_permissions_subject ON page_permissions (subject_type, subject_id);

CREATE TRIGGER page_permissions_updated_at BEFORE UPDATE ON page_permissions
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- 權限中斷點旗標（預設所有頁面都繼承父層）
ALTER TABLE pages ADD COLUMN inherits_permissions boolean NOT NULL DEFAULT true;

-- ROLLBACK:
-- ALTER TABLE pages DROP COLUMN IF EXISTS inherits_permissions;
-- DROP TABLE IF EXISTS page_permissions, favorites, files CASCADE;
-- DROP TYPE IF EXISTS permission_subject, page_role;
