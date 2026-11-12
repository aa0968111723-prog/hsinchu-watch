#!/usr/bin/env bash
# 從 data/ 一致快照建置 dist/（避免與 20 分鐘蒐集同時寫入而混版）
set -euo pipefail
cd "$(dirname "$0")/.."
TS=$(date +%Y%m%d-%H%M%S)
SNAP="${TMPDIR:-/tmp}/hsinchu-watch-snap-$TS"
mkdir -p "$SNAP/src" "$SNAP/out"
# 等蒐集寫完（最多 10 分鐘）再複製，避免混版
flock -w 600 /tmp/hsinchu-watch.collect.lock cp -p data/items.json data/polls.json data/stats.json data/polls_verified.json data/excluded.json "$SNAP/src/"
# 先 finalize 到快照目錄，算內容雜湊（剝除 generated_at 等每輪時間欄）
HW_SRC="$SNAP/src" HW_OUT="$SNAP/out" HW_EXCLUDED="$SNAP/excluded.json" python3 scripts/finalize_data.py
# HW_CONTENT_HASH_FILE：上次成功部署的雜湊；相同 → 跳過 build（exit 3）
if [ -n "${HW_CONTENT_HASH_FILE:-}" ] && [ -s "$HW_CONTENT_HASH_FILE" ]; then
  if python3 scripts/content_hash.py "$SNAP/out" --compare "$HW_CONTENT_HASH_FILE"; then
    echo "content_unchanged snapshot=$SNAP"; exit 3
  fi
fi
npm run build
rm -rf dist/data && mkdir -p dist/data
cp -pr "$SNAP/out/." dist/data/
HW_PUB=dist/data python3 scripts/ci_checks.py
.venv/bin/python scripts/ci_render_sources.py dist  # 每張條目卡須有來源名＋連結
echo "snapshot=$SNAP"
du -sh dist
