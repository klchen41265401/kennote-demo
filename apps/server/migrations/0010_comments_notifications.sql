-- ============================================================
-- 0010_comments_notifications.sql   (M5)
-- 為什麼：留言系統（03 §4.9）與通知中心（03 §4.10）的資料層。
--
-- 與 03 的差異（本專案 pages / blocks 兩張表，見 docs/adr/0002）：
--   03 的 discussions.block_id 指向「頁面 block」，本專案改成
--   page_id（必填，討論串一定屬於某一頁）+ block_id（可為 NULL = 頁面層級討論串）。
--   這樣「列出這一頁的所有討論串」是單一索引查詢，不必先解析 block 屬於哪一頁。
--
-- 行內留言的錨點：**用 rich text 上的 { t:'comment', id } mark**，
--   不用字元位移（03 §4.9 的警告：原文被編輯後位移就失效了）。
--   anchor.quote 只是討論串被孤立時的顯示備援。
-- ============================================================

CREATE TABLE discussions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  -- NULL = 頁面層級討論串
  block_id      uuid REFERENCES blocks(id) ON DELETE CASCADE,
  -- {"kind":"page"} | {"kind":"inline","quote":"被選取的文字"} | {"kind":"property","property":"n8Xz"}
  anchor        jsonb NOT NULL DEFAULT '{"kind":"page"}'::jsonb,
  resolved_at   timestamptz,
  resolved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  CONSTRAINT chk_discussions_anchor CHECK (jsonb_typeof(anchor) = 'object' AND anchor ? 'kind')
);

-- 右側留言面板：一頁的所有討論串
CREATE INDEX idx_discussions_page ON discussions (page_id, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_discussions_block ON discussions (block_id, created_at)
  WHERE deleted_at IS NULL AND block_id IS NOT NULL;
-- 「未解決的討論」清單
CREATE INDEX idx_discussions_open ON discussions (workspace_id, created_at DESC)
  WHERE resolved_at IS NULL AND deleted_at IS NULL;

CREATE TRIGGER discussions_updated_at BEFORE UPDATE ON discussions
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TABLE comments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  discussion_id   uuid NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  author_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  -- RichText（可含 @mention atom、連結）
  body            jsonb NOT NULL DEFAULT '[]'::jsonb,
  plain_text      text NOT NULL DEFAULT '',
  -- 從 body 萃取，發通知與索引用
  mentioned_users uuid[] NOT NULL DEFAULT '{}',
  attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,
  version         bigint NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT chk_comments_body_array CHECK (jsonb_typeof(body) = 'array')
);

CREATE INDEX idx_comments_discussion ON comments (discussion_id, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_author ON comments (author_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_comments_mentions ON comments USING GIN (mentioned_users);

CREATE TRIGGER comments_version BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION trg_bump_version();

-- ------------------------------------------------------------
-- subscriptions —— 頁面追蹤（01 §6 M5.3.3）。
-- 'auto' = 因為編輯或留言而自動追蹤；'muted' = 明確取消（優先於 auto）
-- ------------------------------------------------------------
CREATE TABLE subscriptions (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_id       uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'auto',
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, page_id),
  CONSTRAINT chk_sub_kind CHECK (kind IN ('explicit','auto','muted'))
);

CREATE INDEX idx_subscriptions_page ON subscriptions (page_id) WHERE kind <> 'muted';

-- ------------------------------------------------------------
-- notifications —— payload 刻意存快照（反正規化）：
-- 收件匣列 50 則時不必 JOIN 50 次，頁面被刪掉通知也不會壞（03 §4.10）
-- ------------------------------------------------------------
CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  -- 'mention' | 'comment_reply' | 'comment_resolved' | 'page_shared'
  -- | 'invite' | 'permission_changed' | 'page_updated'
  type          text NOT NULL,
  page_id       uuid REFERENCES pages(id) ON DELETE CASCADE,
  block_id      uuid REFERENCES blocks(id) ON DELETE CASCADE,
  discussion_id uuid REFERENCES discussions(id) ON DELETE CASCADE,
  comment_id    uuid REFERENCES comments(id) ON DELETE CASCADE,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 聚合鍵：同一頁 5 分鐘內的多次編輯合併成一則
  group_key     text,
  read_at       timestamptz,
  archived_at   timestamptz,
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_notifications_payload CHECK (jsonb_typeof(payload) = 'object')
);

-- 收件匣主查詢：時間倒序
CREATE INDEX idx_notif_inbox ON notifications (recipient_id, created_at DESC)
  WHERE archived_at IS NULL;
-- 未讀數 badge
CREATE INDEX idx_notif_unread ON notifications (recipient_id, created_at DESC)
  WHERE read_at IS NULL AND archived_at IS NULL;
-- 聚合去重（同一個 group_key 只留一則）
CREATE UNIQUE INDEX uq_notif_group ON notifications (recipient_id, group_key)
  WHERE group_key IS NOT NULL;
-- 待投遞佇列（email / push worker）
CREATE INDEX idx_notif_pending ON notifications (created_at) WHERE delivered_at IS NULL;

-- ROLLBACK:
-- DROP TABLE IF EXISTS notifications, subscriptions, comments, discussions CASCADE;
