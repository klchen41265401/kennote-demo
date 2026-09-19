-- ============================================================
-- 0011_share_invites.sql   (M5)
-- 為什麼：公開分享連結（04 §8 M5-12）與工作區邀請。
--
-- page_permissions / page_role / pages.inherits_permissions 在 0004 已經建好，
-- 這一支只補「分享」需要的兩張表，權限解析用既有的形狀（permissions/service.ts）。
-- ============================================================

CREATE TABLE public_links (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  -- 不透明隨機字串（base64url），URL 是 {PUBLIC_BASE_URL}/public/{token}
  token         text NOT NULL,
  -- argon2 雜湊；NULL = 不需要密碼
  password_hash text,
  expires_at    timestamptz,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz
);

CREATE UNIQUE INDEX uq_public_links_token ON public_links (token) WHERE revoked_at IS NULL;
-- 一頁同時只有一條有效的公開連結（再次開啟 = 沿用同一條）
CREATE UNIQUE INDEX uq_public_links_page ON public_links (page_id) WHERE revoked_at IS NULL;

CREATE TRIGGER public_links_updated_at BEFORE UPDATE ON public_links
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ------------------------------------------------------------
-- workspace_invites —— 邀請尚未註冊的 email。
-- 已註冊的使用者由 POST /api/workspaces/:id/invites 直接加成 member，不走這張表。
-- ------------------------------------------------------------
CREATE TABLE workspace_invites (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email         citext NOT NULL,
  role          workspace_role NOT NULL DEFAULT 'member',
  token         text NOT NULL,
  invited_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '14 days',
  accepted_at   timestamptz,
  accepted_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_invites_email CHECK (position('@' IN email) > 1)
);

CREATE UNIQUE INDEX uq_workspace_invites_token ON workspace_invites (token);
CREATE UNIQUE INDEX uq_workspace_invites_pending ON workspace_invites (workspace_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_workspace_invites_email ON workspace_invites (email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ROLLBACK:
-- DROP TABLE IF EXISTS workspace_invites, public_links CASCADE;
