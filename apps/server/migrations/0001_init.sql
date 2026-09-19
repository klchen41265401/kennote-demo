-- ============================================================
-- 0001_init.sql
-- 為什麼：建立「身分」這一層 —— 使用者、外部身分（OIDC 插槽）、refresh session、
--         工作區與成員。這幾張表之外的一切都掛在 workspace 底下（多租戶隔離，03 §3.2）。
-- 慣例：uuid v7 主鍵、timestamptz（UTC）、軟刪除 deleted_at + 部分索引。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_bytes / gen_random_uuid
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- 中文子字串 / 模糊搜尋（0005 用）
CREATE EXTENSION IF NOT EXISTS btree_gin;  -- 複合 GIN（scalar + jsonb）
CREATE EXTENSION IF NOT EXISTS citext;     -- 大小寫不敏感的 email

-- ------------------------------------------------------------
-- UUID v7：時間有序，插入時 B-tree 不會亂跳（03 §3.1）。
-- PostgreSQL 18 起有內建 uuidv7()；16/17 用這支 fallback。
-- 注意：規格書 03 §3.1 的版本用 set_bit 設定 version 位元，位元編號與
-- PostgreSQL 的 set_bit(bytea) 語意不符（bit n = byte n/8 的第 n%8 個「最低位」位元），
-- 會產生錯誤的 version nibble。這裡改用 set_byte 明確覆寫 version 與 variant。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE PARALLEL SAFE AS $fn$
DECLARE
  buf bytea;
BEGIN
  buf := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
         || gen_random_bytes(10);
  buf := set_byte(buf, 6, (get_byte(buf, 6) & 15) | 112);   -- version = 0111
  buf := set_byte(buf, 8, (get_byte(buf, 8) & 63) | 128);   -- variant = 10
  RETURN encode(buf, 'hex')::uuid;
END $fn$;

CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $fn$;

CREATE OR REPLACE FUNCTION trg_bump_version() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $fn$;

-- ------------------------------------------------------------
-- users
-- ------------------------------------------------------------
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email             citext NOT NULL,
  email_verified_at timestamptz,
  name              text NOT NULL DEFAULT '',
  avatar_url        text,
  locale            text NOT NULL DEFAULT 'zh-TW',
  timezone          text NOT NULL DEFAULT 'Asia/Taipei',
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CONSTRAINT chk_users_email CHECK (position('@' IN email) > 1)
);

CREATE UNIQUE INDEX uq_users_email ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_last_seen ON users (last_seen_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ------------------------------------------------------------
-- user_identities —— 一個 user 可綁多個身分；本地密碼也只是其中一種（04 §5.5）
-- 「之後要接 Google 登入」= 只加一個 provider 檔案，不動這張表
-- ------------------------------------------------------------
CREATE TABLE user_identities (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      text NOT NULL,              -- 'local' | 'google' | 'line' | ...
  external_id   text NOT NULL,              -- local 時 = 小寫 email
  password_hash text,                       -- 只有 provider='local' 有值
  profile       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_identities UNIQUE (provider, external_id)
);

CREATE INDEX idx_user_identities_user ON user_identities (user_id);

CREATE TRIGGER user_identities_updated_at BEFORE UPDATE ON user_identities
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ------------------------------------------------------------
-- sessions —— refresh token（不透明字串，只存 sha256）
-- rotation + 重用偵測：family_id 相同的整串 token 可一次撤銷（04 §5.5）
-- ------------------------------------------------------------
CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,                     -- 同一次登入輪替出來的所有 token 共用
  token_hash  text NOT NULL,                     -- sha256(不透明 token)
  parent_id   uuid REFERENCES sessions(id) ON DELETE SET NULL,
  user_agent  text,
  ip          inet,
  expires_at  timestamptz NOT NULL,
  rotated_at  timestamptz,                       -- 已被輪替（再被使用 = 重用攻擊）
  revoked_at  timestamptz,
  revoked_reason text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sessions_token_hash UNIQUE (token_hash)
);

CREATE INDEX idx_sessions_user ON sessions (user_id, created_at DESC);
CREATE INDEX idx_sessions_family ON sessions (family_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at) WHERE revoked_at IS NULL;

-- ------------------------------------------------------------
-- workspaces
-- ------------------------------------------------------------
CREATE TABLE workspaces (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  name         text NOT NULL,
  slug         text NOT NULL,
  icon         text,
  owner_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  plan         text NOT NULL DEFAULT 'free',
  settings     jsonb NOT NULL DEFAULT '{}'::jsonb,
  version      bigint NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE UNIQUE INDEX uq_workspaces_slug ON workspaces (lower(slug)) WHERE deleted_at IS NULL;
CREATE INDEX idx_workspaces_owner ON workspaces (owner_id) WHERE deleted_at IS NULL;

CREATE TRIGGER workspaces_version BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION trg_bump_version();

-- ------------------------------------------------------------
-- workspace_members —— 工作區角色是「上限」，實際權限 = min(角色, page_permissions)
-- ------------------------------------------------------------
CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member', 'guest');

CREATE TABLE workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         workspace_role NOT NULL DEFAULT 'member',
  member_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  PRIMARY KEY (workspace_id, user_id)
);

-- 「我加入了哪些工作區」：登入後第一個查詢
CREATE INDEX idx_ws_members_user ON workspace_members (user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ws_members_role ON workspace_members (workspace_id, role) WHERE deleted_at IS NULL;

CREATE TRIGGER ws_members_updated_at BEFORE UPDATE ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ROLLBACK:
-- DROP TABLE IF EXISTS workspace_members, workspaces, sessions, user_identities, users CASCADE;
-- DROP TYPE IF EXISTS workspace_role;
-- DROP FUNCTION IF EXISTS trg_bump_version(), trg_set_updated_at(), uuid_generate_v7();
