#!/usr/bin/env bash
# hsinchu-watch 每 20 分鐘例行：安全蒐集 →（資料有變才）建置＋閘門 → 部署。
# 失敗或逾時：data/ 與線上站不動。log 寫 work/柏能/collect_HHMM.log（與舊例行相同位置）。
set -uo pipefail
cd "$(dirname "$0")/.."
# 整輪硬上限 RUN_TIMEOUT（預設 900s）：先以 timeout 重新執行自己一次，再取整輪鎖（鎖由受時限的行程持有）。
# 內層仍各自有限：safe_collect 540s（其內 run_all 單源 120／ROUND_CAP 420／硬殺 480）。
RUN_TIMEOUT="${RUN_TIMEOUT:-900}"
if [ -z "${HW_UNDER_TIMEOUT:-}" ]; then
  HW_UNDER_TIMEOUT=1 exec timeout --kill-after=30 "$RUN_TIMEOUT" bash "$0" "$@"
fi
TS=$(date +%H%M)
LOG="work/柏能/collect_${TS}.log"
[ -n "${HW_TEST_LOG:-}" ] && LOG="$HW_TEST_LOG"   # 測試用
mkdir -p "$(dirname "$LOG")"
T_START=$(date +%s)
ROUND_RESULT=OK; ROUND_REASON=""; ROUND_DEPLOY=none
exec 3>&1   # 原始 stdout：摘要同時給呼叫端（routine）看
_round_summary() {
  local ec=$?
  local line="[round] summary result=${ROUND_RESULT} reason=${ROUND_REASON:-none} deploy=${ROUND_DEPLOY} ec=${ec} elapsed=$(( $(date +%s) - T_START ))s"
  echo "$line" >> "$LOG"; echo "$line" >&3
  exit "$ec"
}
trap _round_summary EXIT
trap 'ROUND_RESULT=FAILED; ROUND_REASON=round_timeout; exit 124' TERM
# 整輪互斥：用「專屬」鎖。絕不可用 collect.lock（run_all 內部會拿，外層也持有就死鎖，01:25）、
# round.lock（safe_collect 自己的鎖，同檔會讓蒐集永遠 skip）、deploy.lock（deploy.sh 用）。
ROUND_LOCK="${HW_ROUND_LOCK:-/tmp/hsinchu-watch.routine_round.lock}"
case "$ROUND_LOCK" in
  /tmp/hsinchu-watch.collect.lock|/tmp/hsinchu-watch.round.lock|/tmp/hsinchu-watch.deploy.lock)
    ROUND_RESULT=FAILED; ROUND_REASON=bad_round_lock; echo "[round] refuse: routine lock must differ from collect/round/deploy locks" >> "$LOG"; exit 2 ;;
esac
exec 8>"$ROUND_LOCK"
if ! flock -n 8; then
  ROUND_RESULT=SKIPPED; ROUND_REASON=round_busy
  echo "[round] $(date '+%F %T') skip(round_busy) another round holds $ROUND_LOCK" >> "$LOG"; exit 0
fi
# 子行程不繼承整輪鎖的 fd 8 也無妨（鎖檔與其他鎖皆不同）
# 磁碟門檻：MIN_FREE_KB（預設 1572864＝1.5G）或 MIN_FREE_GB（可小數，優先）
if [ -n "${MIN_FREE_GB:-}" ]; then MIN_FREE_KB=$(awk -v g="$MIN_FREE_GB" 'BEGIN{printf "%d", g*1048576}'); fi
export MIN_FREE_KB="${MIN_FREE_KB:-1572864}"
{
  echo "[round] start $(date '+%F %T') Asia/Taipei"
  # 磁碟守衛：剩餘 < MIN_FREE_KB 就整輪跳過（不蒐集、不部署）
  FREE_KB=$(df -Pk . | awk 'NR==2{print $4}')
  if [ "${FREE_KB:-0}" -lt "$MIN_FREE_KB" ]; then
    ROUND_RESULT=SKIPPED; ROUND_REASON=low_disk
    echo "[round] disk free $((FREE_KB/1024))M < $((MIN_FREE_KB/1024))M; skip collect+deploy reason=low_disk"; exit 0
  fi
  # 心跳：內容沒變時網站 manifest.generated_at 不會前進，前端會誤報「資料延遲」（≥1h）。
  # 距上次成功部署超過 HW_HEARTBEAT_MIN 分鐘（預設 30；0＝停用）就強制建置＋部署一次（只更新時間戳）。
  HASHF=/workspace/hsinchu-watch-backups/last-deploy-content.sha256
  HB_DUE=0
  HEARTBEAT_MIN="${HW_HEARTBEAT_MIN:-30}"
  if [ "${HEARTBEAT_MIN}" -gt 0 ] 2>/dev/null && [ -s "$HASHF" ]; then
    HB_AGE=$(( $(date +%s) - $(stat -c %Y "$HASHF" 2>/dev/null || date +%s) ))
    [ "$HB_AGE" -ge $(( HEARTBEAT_MIN * 60 )) ] && HB_DUE=1
  fi
  # r7：sitemap 增量狀態放 git／Pages 之外；safe_collect 只在整輪成功後才升格
  export HSINCHU_SITEMAP_STATE_PATH=/workspace/hsinchu-watch-backups/state/sitemap_fetch_state.json
  mkdir -p "$(dirname "$HSINCHU_SITEMAP_STATE_PATH")"
  # 時限：單源 ≤120s、ROUND_CAP 420s、safe_collect 硬殺 480s、本層 timeout 540s（外層 workflow 600s）
  OUT=$(timeout 540 python3 scripts/safe_collect.py 2>&1); rc=$?
  echo "$OUT"
  echo "[round] safe_collect rc=$rc"
  if [ $rc -ne 0 ]; then
    # 機器可讀原因：timeout 540 → collect_timeout；safe_collect 75 → low_disk；其餘取 SAFE_COLLECT_RESULT.result
    # safe_collect 75＝skipped（磁碟不足或另一輪 safe_collect 進行中），看 reason 文字分辨
    SC_RES=$(printf '%s\n' "$OUT" | sed -n 's/^SAFE_COLLECT_RESULT //p' | tail -1 \
      | python3 -c "import json,sys;d=json.load(sys.stdin);r=d.get('result','');m=d.get('reason','') or '';print('low_disk' if 'disk' in m else ('collect_busy' if 'another round' in m else r))" 2>/dev/null || true)
    case "$rc" in
      124|137) ROUND_REASON=collect_timeout ;;
      *) ROUND_REASON=${SC_RES:-collect_fail} ;;
    esac
    ROUND_RESULT=SKIPPED
    echo "[round] no deploy (collect/guard failed or skipped; data/ untouched) reason=$ROUND_REASON rc=$rc"; exit 0
  fi
  if ! printf '%s' "$OUT" | grep 'SAFE_COLLECT_RESULT' | grep -q '"changed": true'; then
    if [ "$HB_DUE" != 1 ]; then
      ROUND_RESULT=SKIPPED; ROUND_REASON=data_unchanged; ROUND_DEPLOY=skip
      echo "[round] deploy=skip(data_unchanged)"; exit 0
    fi
    echo "[round] data unchanged but heartbeat due (>=${HEARTBEAT_MIN}min since last deploy) -> rebuild+deploy to refresh generated_at"
  fi
  # 閘門（任何一項失敗即不部署）
  # finalize 後算 combined_content_sha256，與上次成功部署相同 → 跳過 build＋deploy
  if [ "$HB_DUE" = 1 ]; then ./scripts/build_snapshot.sh; brc=$?   # 不帶雜湊檔＝強制建置
  else HW_CONTENT_HASH_FILE="$HASHF" ./scripts/build_snapshot.sh; brc=$?; fi
  if [ $brc -eq 3 ]; then ROUND_RESULT=SKIPPED; ROUND_REASON=content_unchanged; ROUND_DEPLOY=skip; echo "[round] deploy=skip(content_unchanged) sha=$(cut -c1-12 "$HASHF")"; exit 0; fi
  [ $brc -eq 0 ] || { ROUND_RESULT=FAILED; ROUND_REASON=build_fail; echo "[round] build failed rc=$brc; no deploy reason=build_fail"; exit 0; }
  HW_PUB=dist/data python3 scripts/ci_checks.py || { ROUND_RESULT=FAILED; ROUND_REASON=check_fail; echo "[round] ci_checks failed; no deploy reason=check_fail"; exit 1; }
  if [ -f work/資安長/scan_prepush.py ]; then
    SCAN=$(python3 work/資安長/scan_prepush.py --root . 2>&1)
    printf '%s\n' "$SCAN" | tail -1 | grep -q clean || { ROUND_RESULT=FAILED; ROUND_REASON=scan_not_clean; echo "[round] scan_prepush not clean; no deploy reason=scan_not_clean"; printf '%s\n' "$SCAN" | tail -20; exit 0; }
  fi
  if [ -f work/AI系統維護員/ci_gate.py ]; then
    python3 work/AI系統維護員/ci_gate.py --root . --persons-mode warn -o /tmp/hw_ci_gate.md --json /tmp/hw_ci_gate.json >/dev/null 2>&1
    grep -q "FAIL=0" /tmp/hw_ci_gate.md || { ROUND_RESULT=FAILED; ROUND_REASON=ci_gate_fail; echo "[round] ci_gate FAIL; no deploy reason=ci_gate_fail"; exit 0; }
  fi
  # 發布前守衛：dist/data（須含 official.json 與 manifest.counts 新欄位）對上次成功部署的同格式資料
  # 基準只用「新格式」發布資料（有 official.json＋manifest.counts.excluded_collect）：
  # 1) 上次成功部署 last-deploy-data  2) DB備份監控員 snap_0250/public_data；
  # 絕不用 git HEAD public/data（舊格式會誤判 181→33）。都不合格就不帶 --prev（只做結構檢查）。
  LAST=/workspace/hsinchu-watch-backups/last-deploy-data
  PREV_ARG=""
  for CAND in "$LAST" work/DB備份監控員/snap_0250/public_data; do
    if [ -f "$CAND/official.json" ] && python3 -c "import json,sys;c=json.load(open(sys.argv[1]+'/manifest.json')).get('counts',{});sys.exit(0 if all(k in c for k in ('excluded_collect','excluded_publish','pending_review')) else 1)" "$CAND" 2>/dev/null; then
      PREV_ARG="--prev $CAND"; break
    fi
  done
  echo "[round] publish guard baseline: ${PREV_ARG:-none(new-format baseline missing)}"
  if ! python3 scripts/guard_data.py --data dist/data $PREV_ARG --drop-threshold 0.5 --max-age-minutes 0; then
    ROUND_RESULT=FAILED; ROUND_REASON=publish_guard_fail; echo "[round] publish guard FAIL; no deploy reason=publish_guard_fail"; exit 0
  fi
  # 只用 Wrangler Direct Upload；不要啟用 Cloudflare Pages 的 Git 整合建置
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f /home/box/.secrets/cloudflare.env ]; then
    set -a; . /home/box/.secrets/cloudflare.env; set +a
  fi
  if [ "${HW_DRY_RUN:-0}" = 1 ]; then ROUND_REASON=dry_run; ROUND_DEPLOY=would_deploy; echo "[round] deploy=would_deploy(content_changed) DRY_RUN"; exit 0; fi
  # deploy.sh 成功後才寫入 last-deploy-content.sha256 與 last-deploy-data/
  DOUT=$(SKIP_BUILD=1 ./deploy.sh 2>&1); echo "$DOUT" | grep -E "Deployment complete|stored content_sha256|✘|ERROR|another deploy"
  if echo "$DOUT" | grep -q "Deployment complete"; then ROUND_DEPLOY=done; [ "$HB_DUE" = 1 ] && ROUND_REASON=heartbeat; echo "[round] deploy=done"
  else ROUND_RESULT=FAILED; ROUND_REASON=deploy_fail; ROUND_DEPLOY=failed; echo "[round] deploy=failed reason=deploy_fail"; fi
  echo "[round] end $(date '+%F %T')"
} > "$LOG" 2>&1
tail -n 3 "$LOG"
