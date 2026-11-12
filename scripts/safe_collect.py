#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""安全蒐集一輪（主線版；改寫自 work/DB備份監控員/safe_collect.py）。

順序：round lock（同時只跑一輪）→ 舊 data/ 複製到暫存 → run_all 寫暫存（含整輪逾時）
     → guard（暫存 vs 正式 data/）→ collect lock 內：快照舊 data/ → 原子換入。
任何失敗：data/ 與線上站都不動。stale_data／no_update 只記警告；incomplete／count_drop 等擋下。
輸出最後一行 JSON 摘要（changed／timing／result）。不刪檔（暫存目錄保留供查）。
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TZ = timezone(timedelta(hours=8))
ROUND_LOCK = "/tmp/hsinchu-watch.round.lock"
COLLECT_LOCK = "/tmp/hsinchu-watch.collect.lock"
SNAP_ROOT = Path(os.environ.get("HSINCHU_SNAPSHOT_ROOT", "/workspace/hsinchu-watch-backups/data-snapshots"))
PY = str(ROOT / ".venv" / "bin" / "python") if (ROOT / ".venv" / "bin" / "python").exists() else sys.executable
STAGE_PARENT = os.environ.get("HSINCHU_STAGE_PARENT") or None  # 預設系統暫存（/tmp）
# PERF r7：硬殺對齊 collectors.config.HARD_KILL_SEC（預設 480）；須 > ROUND_CAP(420) 以完成寫檔
ROUND_TIMEOUT = int(os.environ.get("HSINCHU_ROUND_TIMEOUT", "480"))
WARN_ONLY = {"stale_data", "no_update"}
PROTECTED = {"polls_verified.json", "sitemap_fetch_state.json"}
# r7 sitemap 增量狀態：不進 git、不上 Pages。蒐集時用暫存複本，整輪成功（guard 過、已換入或無變更）才升格回正式路徑；
# 失敗／被擋時不前進，避免「已標看過、但資料沒換入」而漏文。
SITEMAP_STATE = Path(os.environ.get("HSINCHU_SITEMAP_STATE_PATH")
                     or "/workspace/hsinchu-watch-backups/state/sitemap_fetch_state.json")
# 縮圖網址增量快取（collectors/images.py）：同樣不進 git／Pages，暫存複本＋整輪成功才升格
IMAGE_CACHE = Path(os.environ.get("HSINCHU_IMAGE_CACHE_PATH")
                   or "/workspace/hsinchu-watch-backups/state/image_cache.json")
VOLATILE = {"collected_at", "fetched_at", "generated_at"}


def now():
    return datetime.now(TZ).isoformat(timespec="seconds")


def sha(p: Path) -> str | None:
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def jsons(d: Path):
    return sorted(p for p in d.iterdir() if p.is_file() and p.suffix == ".json") if d.is_dir() else []


def content_sig(d: Path) -> str:
    """變更判定：items/polls 全文＋stats（去掉 generated_at 等時間欄）。"""
    h = hashlib.sha256()
    for n in ("items.json", "polls.json"):
        p = d / n
        try:
            rows = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(rows, list):  # 每輪都會刷新的時間欄不算「資料有變」
                rows = [{k: v for k, v in r.items() if k not in VOLATILE} if isinstance(r, dict) else r
                        for r in rows]
            h.update(json.dumps(rows, sort_keys=True, ensure_ascii=False).encode())
        except Exception:
            h.update(p.read_bytes() if p.exists() else b"missing")
    try:
        st = json.loads((d / "stats.json").read_text(encoding="utf-8"))
        for k in ("generated_at", "finalized_at"):
            st.pop(k, None)
        for v in (st.get("source_stats") or {}).values():  # 每源耗時／暫存路徑每輪不同（state_path 每輪是新 /tmp 目錄）
            if isinstance(v, dict):
                v.pop("elapsed_sec", None)
                v.pop("state_path", None)
                for k in [k for k in v if k.endswith("_this_round")]:  # images 本輪抓取數：不算內容變更
                    v.pop(k, None)
        h.update(json.dumps(st, sort_keys=True, ensure_ascii=False).encode())
    except Exception:
        h.update(b"no-stats")
    return h.hexdigest()


def summary(**kw):
    print("SAFE_COLLECT_RESULT " + json.dumps(kw, ensure_ascii=False), flush=True)


def main() -> int:
    t_start = time.monotonic()
    rl = open(ROUND_LOCK, "w")
    try:
        fcntl.flock(rl, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        summary(result="skipped", reason="another round running", at=now())
        return 75

    free = shutil.disk_usage(str(ROOT)).free
    min_free = int(os.environ.get("MIN_FREE_KB") or 1572864) * 1024  # 預設 1.5G；routine_round 傳入
    if free < min_free:
        summary(result="skipped", reason=f"disk free {free // 2**20}M < {min_free // 2**20}M", data_untouched=True, at=now())
        return 75
    stage_root = Path(tempfile.mkdtemp(prefix="hsinchu_stage_", dir=STAGE_PARENT))
    stage = stage_root / "data"
    pub = stage_root / "public_data"
    stage.mkdir()
    pub.mkdir()
    for p in jsons(DATA):
        shutil.copy2(p, stage / p.name)
    before_sig = content_sig(DATA)

    env = os.environ.copy()
    env["HSINCHU_DATA_DIR"] = str(stage)
    env["HSINCHU_PUBLIC_DATA_DIR"] = str(pub)
    env["PYTHONUNBUFFERED"] = "1"
    stage_state = stage_root / "sitemap_fetch_state.json"
    if SITEMAP_STATE.is_file():
        shutil.copy2(SITEMAP_STATE, stage_state)
    env["HSINCHU_SITEMAP_STATE_PATH"] = str(stage_state)
    stage_images = stage_root / "image_cache.json"
    if IMAGE_CACHE.is_file():
        shutil.copy2(IMAGE_CACHE, stage_images)
    env["HSINCHU_IMAGE_CACHE_PATH"] = str(stage_images)
    log = stage_root / "collect.log"
    t0 = time.monotonic()
    try:
        with open(log, "w") as lf:
            rc = subprocess.run([PY, "-m", "collectors.run_all", "--data-dir", str(stage),
                                 "--public-data-dir", str(pub)], cwd=ROOT, env=env, stdout=lf,
                                stderr=subprocess.STDOUT, timeout=ROUND_TIMEOUT).returncode
    except subprocess.TimeoutExpired:
        rc = 124
    collect_s = round(time.monotonic() - t0, 1)
    logtxt = log.read_text(encoding="utf-8", errors="replace")
    sys.stdout.write(logtxt)
    # 來源標頭與「->」結果之間可能夾著來源自己的進度行（如 [sitemap] site=...）
    _gap = r"(?:(?!\[collect\])[^\n]*\n)*?"
    timeouts = re.findall(r"\[collect\] (\w+) \.\.\. \(deadline[^\n]*\n" + _gap + r"\s+-> SKIP deadline", logtxt)
    per_source = dict(re.findall(r"\[collect\] (\w+) \.\.\. \(deadline[^\n]*\n" + _gap + r"\s+-> (?:SKIP deadline |\d+\s+)([\d.]+)s", logtxt))
    if rc != 0:
        summary(result="collect_failed", rc=rc, collect_s=collect_s, timeouts=timeouts,
                staging=str(stage_root), data_untouched=True, at=now())
        return 1

    t1 = time.monotonic()
    g = subprocess.run([sys.executable, str(ROOT / "scripts" / "guard_data.py"), "--data", str(stage),
                        "--prev", str(DATA), "--drop-threshold", "0.5", "--max-age-minutes", "45",
                        "--require-change"], cwd=ROOT, capture_output=True, text=True)
    print(g.stdout, end="")
    fails = re.findall(r"^FAIL\s+\[([^\]]*)\]\s+(\w+):", g.stdout, re.M)
    blocking = sorted({f"{f}:{c}" for f, c in fails if c not in WARN_ONLY})
    warnings = sorted({f"{f}:{c}" for f, c in fails if c in WARN_ONLY})
    if warnings:
        print(f"[safe_collect] WARN (not blocking): {', '.join(warnings)}", flush=True)
    guard_s = round(time.monotonic() - t1, 1)
    if blocking or (g.returncode not in (0, 1)):
        summary(result="guard_blocked", blocking=blocking, warnings=warnings, collect_s=collect_s,
                guard_s=guard_s, timeouts=timeouts, staging=str(stage_root), data_untouched=True, at=now())
        return 1

    after_sig = content_sig(stage)
    changed = after_sig != before_sig
    swapped = []
    snap_rc = None
    if changed:
        with open(COLLECT_LOCK, "w") as cl:
            lock_deadline = time.monotonic() + 60  # 與補丁 009 同：鎖等待有上限
            while True:
                try:
                    fcntl.flock(cl, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() > lock_deadline:
                        summary(result="lock_timeout", collect_s=collect_s, data_untouched=True,
                                staging=str(stage_root), at=now())
                        return 1
                    time.sleep(0.5)
            SNAP_ROOT.mkdir(parents=True, exist_ok=True)
            snap_rc = subprocess.run([sys.executable, str(ROOT / "scripts" / "snapshot.py"), "--data-dir",
                                      str(DATA), "--out-root", str(SNAP_ROOT), "snapshot"],
                                     cwd=ROOT, capture_output=True, text=True)
            print(snap_rc.stdout[-800:], end="")
            if snap_rc.returncode != 0:
                summary(result="snapshot_failed", collect_s=collect_s, data_untouched=True,
                        staging=str(stage_root), at=now(), stderr=snap_rc.stderr[-300:])
                return 1
            for p in jsons(stage):
                if p.name in PROTECTED:  # 人工核對檔：蒐集器不擁有，不覆寫
                    continue
                tmp = DATA / f".{p.name}.safe_collect.tmp"
                shutil.copy2(p, tmp)
                os.replace(tmp, DATA / p.name)
                swapped.append(p.name)
    state_promoted = False
    if stage_state.is_file():
        SITEMAP_STATE.parent.mkdir(parents=True, exist_ok=True)
        tmp = SITEMAP_STATE.with_name(SITEMAP_STATE.name + ".tmp")
        shutil.copy2(stage_state, tmp)
        os.replace(tmp, SITEMAP_STATE)
        state_promoted = True
    if stage_images.is_file():
        IMAGE_CACHE.parent.mkdir(parents=True, exist_ok=True)
        tmp = IMAGE_CACHE.with_name(IMAGE_CACHE.name + ".tmp")
        shutil.copy2(stage_images, tmp)
        os.replace(tmp, IMAGE_CACHE)
    summary(result="ok", changed=changed, sitemap_state_promoted=state_promoted, per_source_s=per_source, swapped=swapped, warnings=warnings, timeouts=timeouts,
            collect_s=collect_s, guard_s=guard_s, total_s=round(time.monotonic() - t_start, 1),
            staging=str(stage_root), at=now())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
