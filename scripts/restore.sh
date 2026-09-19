#!/usr/bin/env bash
# ============================================================
# kennote 還原（03 §11.3、04 §8 M6 驗收標準：
#   「備份腳本從乾淨環境完整還原成功 —— 實際演練一次，不要只寫腳本」）
#
# 用法：
#   bash scripts/restore.sh backups/kennote-20260919-0315.tar.gz
#   FORCE=1 bash scripts/restore.sh <file>     # 跳過確認（排程演練用）
#
# 這支腳本會：
#   1. 停掉 server 與 web（避免還原到一半有人在寫）
#   2. DROP 並重建資料庫，再 pg_restore
#   3. 還原 uploads volume
#   4. 重新啟動，跑 migration，驗證 /api/health
#
# ⚠️ 這是破壞性操作：現有資料會**全部被覆蓋**。
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="${1:-}"
PG_CONTAINER="${PG_CONTAINER:-kennote-postgres}"
SERVER_CONTAINER="${SERVER_CONTAINER:-kennote-server}"
WEB_CONTAINER="${WEB_CONTAINER:-kennote-web}"
POSTGRES_USER="${POSTGRES_USER:-kennote}"
POSTGRES_DB="${POSTGRES_DB:-kennote}"
UPLOADS_PATH="${UPLOADS_PATH:-/app/data/uploads}"
COMPOSE="${COMPOSE:-docker compose -f $ROOT/docker-compose.prod.yml}"

log() { printf '  %s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

[ -n "$ARCHIVE" ] || die "用法：bash scripts/restore.sh <backups/kennote-YYYYmmdd-HHMM.tar.gz>"
[ -f "$ARCHIVE" ] || die "找不到備份檔：$ARCHIVE"
command -v docker >/dev/null 2>&1 || die "找不到 docker"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "📥 kennote 還原"
tar -xzf "$ARCHIVE" -C "$WORK" || die "備份檔解不開"
[ -f "$WORK/database.dump" ] || die "備份檔裡沒有 database.dump"

echo
echo "── 備份檔資訊 ──────────────────────────────"
cat "$WORK/MANIFEST" 2>/dev/null || echo "（沒有 MANIFEST，可能是舊版備份）"
echo "────────────────────────────────────────────"
echo

# ── 確認 ────────────────────────────────────────────────
if [ "${FORCE:-0}" != "1" ]; then
  echo "⚠️  這會【刪掉】目前的資料庫 $POSTGRES_DB 與 uploads，並用上面這份備份覆蓋。"
  printf '   確定要還原嗎？請輸入大寫的 RESTORE：'
  read -r answer
  [ "$answer" = "RESTORE" ] || die "已取消（沒有做任何變更）"
fi

# ── 1. 停掉應用（資料庫留著）──────────────────────────
log "停止 $SERVER_CONTAINER / $WEB_CONTAINER …"
docker stop "$SERVER_CONTAINER" >/dev/null 2>&1 || true
docker stop "$WEB_CONTAINER" >/dev/null 2>&1 || true

docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || {
  log "postgres 沒在跑，先啟動它…"
  $COMPOSE up -d postgres
  sleep 5
}

# 等 postgres 真的可以連
for i in $(seq 1 30); do
  if docker exec -i "$PG_CONTAINER" pg_isready -U "$POSTGRES_USER" >/dev/null 2>&1; then break; fi
  [ "$i" = "30" ] && die "postgres 一直沒起來"
  sleep 1
done

# ── 2. 重建資料庫 ──────────────────────────────────────
log "斷開既有連線並重建資料庫 $POSTGRES_DB …"
docker exec -i "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "$POSTGRES_DB";
CREATE DATABASE "$POSTGRES_DB" OWNER "$POSTGRES_USER";
SQL

log "pg_restore …"
docker exec -i "$PG_CONTAINER" \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error \
  < "$WORK/database.dump"

# ── 3. 還原附件 ────────────────────────────────────────
if [ -s "$WORK/uploads.tar" ]; then
  log "還原 uploads …"
  # server 容器可能已經被移除，這裡用 volume 名稱掛載
  VOLUME="$(docker volume ls --format '{{.Name}}' | grep -E 'uploads$' | head -n1 || true)"
  if [ -n "$VOLUME" ]; then
    docker run --rm -v "$VOLUME:$UPLOADS_PATH" -w / -i alpine \
      sh -c "rm -rf ${UPLOADS_PATH:?}/* && tar -xf - " < "$WORK/uploads.tar"
    log "  → volume $VOLUME"
  else
    log "⚠️  找不到 uploads volume，附件沒有還原"
  fi
else
  log "備份裡沒有附件，略過"
fi

# ── 4. 起回來並驗證 ───────────────────────────────────
log "啟動服務（server 會自動跑 migration）…"
$COMPOSE up -d

log "等待 /api/health …"
OK=0
for i in $(seq 1 60); do
  BODY="$(docker exec -i "$SERVER_CONTAINER" node -e \
    "fetch('http://127.0.0.1:4000/api/health').then(r=>r.text()).then(t=>{console.log(t)}).catch(()=>process.exit(1))" 2>/dev/null || true)"
  if echo "$BODY" | grep -q '"status":"ok"'; then OK=1; echo "  $BODY"; break; fi
  sleep 2
done
[ "$OK" = "1" ] || die "服務起來了但 /api/health 不是 ok，請看 docker logs $SERVER_CONTAINER"

# ── 5. 抽查資料真的回來了 ─────────────────────────────
log "抽查資料筆數："
docker exec -i "$PG_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -F' | ' <<'SQL'
SELECT 'users', count(*) FROM users
UNION ALL SELECT 'workspaces', count(*) FROM workspaces
UNION ALL SELECT 'pages', count(*) FROM pages
UNION ALL SELECT 'blocks', count(*) FROM blocks
UNION ALL SELECT 'files', count(*) FROM files
UNION ALL SELECT 'migrations', count(*) FROM schema_migrations;
SQL

echo "✅ 還原完成。請用瀏覽器開一次首頁，確認頁面與圖片都在。"
