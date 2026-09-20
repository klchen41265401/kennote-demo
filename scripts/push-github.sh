#!/usr/bin/env bash
# 推到 GitHub 公開 repo：在暫存 clone 裡把私人截圖／採集工具從整段歷史過濾掉再推。
# 用法：bash scripts/push-github.sh [remote-url]
set -euo pipefail
URL="${1:-https://github.com/ken158ken/kennote-demo.git}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/kennote-github-push"
rm -rf "$WORK"
git clone -q "$SRC" "$WORK"
cd "$WORK"
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --index-filter \
  'git rm -r -q --cached --ignore-unmatch reference/notion-capture reference/tools' \
  --prune-empty -- --all >/dev/null 2>&1
if git ls-files | grep -qE '^reference/(notion-capture|tools)/'; then echo "過濾失敗"; exit 1; fi
if git ls-files | grep -qE '^\.env$'; then echo ".env 被追蹤了，中止"; exit 1; fi
git remote add github "$URL"
# 非互動：憑證管理員若要彈 GUI 就直接失敗，不要卡住整個腳本
GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never timeout 300 git push -f github main:main
echo "已推送到 $URL"
