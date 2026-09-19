#!/usr/bin/env bash
# 本機執行：把目前 commit 推到遠端工作樹，然後在遠端用 docker compose (prod) 重建並啟動。
# 用法：bash scripts/deploy.sh [--no-build]
set -euo pipefail
REMOTE=ken150ken150@100.74.148.92
DIR=/home/ken150ken150/kennote
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push deploy "$BRANCH":main
ssh -o BatchMode=yes "$REMOTE" "bash $DIR/scripts/remote-up.sh ${1:-}"
