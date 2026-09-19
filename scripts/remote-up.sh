#!/usr/bin/env bash
# 遠端執行：確保 .env 存在（首次自動產生祕密）、build、啟動、跑 migration、健康檢查。
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(openssl rand -base64 48 | tr -d '\n')
  PGPW=$(openssl rand -hex 16)
  sed -i "s#^JWT_SECRET=.*#JWT_SECRET=${SECRET}#" .env
  sed -i "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=${PGPW}#" .env
  sed -i "s#^NODE_ENV=.*#NODE_ENV=production#" .env
  sed -i "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=http://100.74.148.92:8090#" .env
  sed -i "s#^CORS_ORIGINS=.*#CORS_ORIGINS=#" .env
  sed -i "s#^LOG_LEVEL=.*#LOG_LEVEL=info#" .env
  echo "[remote-up] 已從 .env.example 產生 .env（JWT_SECRET / POSTGRES_PASSWORD 隨機）"
fi
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
if [ "${1:-}" != "--no-build" ]; then
  $COMPOSE build --pull
fi
$COMPOSE up -d --remove-orphans
echo "[remote-up] 等待健康檢查..."
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8090/api/health >/dev/null 2>&1; then
    echo "[remote-up] OK: http://100.74.148.92:8090/"; curl -s http://127.0.0.1:8090/api/health; echo; exit 0
  fi
  sleep 2
done
echo "[remote-up] 健康檢查逾時，容器狀態："; $COMPOSE ps; $COMPOSE logs --tail=50 server; exit 1
