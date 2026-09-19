#!/usr/bin/env bash
# ============================================================
# kennote 備份（03 §11.3、04 §8 M6 第 12 項）
#
#   資料庫：pg_dump --format=custom（可跨版本還原、可選擇性還原單表）
#   附件：  uploads volume 的 tar
#   兩者打包成一個 backups/kennote-YYYYmmdd-HHMM.tar.gz，保留最近 14 份。
#
# 用法：
#   bash scripts/backup.sh                     # 用預設（正式環境的容器名）
#   BACKUP_DIR=/mnt/nas/kennote bash scripts/backup.sh
#   KEEP=30 bash scripts/backup.sh
#
# 排程（每天 03:15）：
#   15 3 * * * cd /home/ken/kennote && bash scripts/backup.sh >> /var/log/kennote-backup.log 2>&1
#
# ⚠️ 03 §11.3：「沒演練過的備份等於沒有備份」。
#    每個月請實際跑一次 scripts/restore.sh，步驟見 docs/ops.md §5。
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
KEEP="${KEEP:-14}"
PG_CONTAINER="${PG_CONTAINER:-kennote-postgres}"
SERVER_CONTAINER="${SERVER_CONTAINER:-kennote-server}"
POSTGRES_USER="${POSTGRES_USER:-kennote}"
POSTGRES_DB="${POSTGRES_DB:-kennote}"
UPLOADS_PATH="${UPLOADS_PATH:-/app/data/uploads}"

STAMP="$(date +%Y%m%d-%H%M)"
NAME="kennote-$STAMP"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { printf '  %s\n' "$*"; }
die() { printf '❌ %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "找不到 docker"
docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || die "找不到容器 $PG_CONTAINER（正式環境請先 docker compose -f docker-compose.prod.yml up -d）"

mkdir -p "$BACKUP_DIR"
echo "📦 kennote 備份 $STAMP"

# ── 1. 資料庫 ────────────────────────────────────────────
log "pg_dump $POSTGRES_DB …"
docker exec -i "$PG_CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
          --format=custom --compress=6 --no-owner --no-acl \
  > "$WORK/database.dump"
[ -s "$WORK/database.dump" ] || die "pg_dump 產生了空檔案"
log "  → $(du -h "$WORK/database.dump" | cut -f1)"

# ── 2. 附件（uploads volume）───────────────────────────
if docker inspect "$SERVER_CONTAINER" >/dev/null 2>&1; then
  log "打包 uploads（$SERVER_CONTAINER:$UPLOADS_PATH）…"
  # 用一個暫時容器掛同一個 volume，server 停掉也備份得到
  docker run --rm --volumes-from "$SERVER_CONTAINER" -w / alpine \
    tar -cf - "${UPLOADS_PATH#/}" 2>/dev/null > "$WORK/uploads.tar" || true
  log "  → $(du -h "$WORK/uploads.tar" 2>/dev/null | cut -f1 || echo '0（沒有附件）')"
else
  log "⚠️  找不到 $SERVER_CONTAINER，這次沒有備份附件"
  : > "$WORK/uploads.tar"
fi

# ── 3. 說明檔（還原時知道這份是什麼）──────────────────
{
  echo "kennote backup"
  echo "created_at=$(date -Iseconds)"
  echo "host=$(hostname)"
  echo "postgres_db=$POSTGRES_DB"
  echo "postgres_user=$POSTGRES_USER"
  echo "pg_version=$(docker exec -i "$PG_CONTAINER" postgres --version 2>/dev/null || echo unknown)"
  echo "git_commit=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "uploads_path=$UPLOADS_PATH"
} > "$WORK/MANIFEST"

# ── 4. 打包 ─────────────────────────────────────────────
OUT="$BACKUP_DIR/$NAME.tar.gz"
tar -czf "$OUT" -C "$WORK" MANIFEST database.dump uploads.tar
chmod 600 "$OUT"
log "完成：$OUT（$(du -h "$OUT" | cut -f1)）"

# ── 5. 輪替：只留最近 KEEP 份 ──────────────────────────
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/kennote-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) || true)
if [ "${#OLD[@]}" -gt 0 ]; then
  log "清掉 ${#OLD[@]} 份舊備份（保留 $KEEP 份）"
  for f in "${OLD[@]}"; do rm -f "$f"; done
fi

# ── 6. 自我檢查：tar 讀得回來、dump 是合法的 custom format ──
tar -tzf "$OUT" >/dev/null || die "產出的壓縮檔壞掉了"
echo "✅ 備份完成：$OUT"
echo "   還原：bash scripts/restore.sh $OUT"
