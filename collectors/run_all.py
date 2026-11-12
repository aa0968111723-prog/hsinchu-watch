# -*- coding: utf-8 -*-
"""python -m collectors.run_all

補丁 009／009 r2：本模組在寫入正式 data/ 時會自行取得 collect.lock
（預設 /tmp/hsinchu-watch.collect.lock；見 COLLECT_LOCK_PATH）。

【呼叫端不可再持 collect.lock】
外層 wrapper／orchestrator／safe_collect 若已 flock 同一路徑，再進本模組會形成
巢狀等待（01:25 卡死 600s、log 空白；01:51 去掉外層鎖後 16s 完成）。
暫存模式（--data-dir／HSINCHU_DATA_DIR）不持此鎖。
"""
from __future__ import annotations
import json
import shutil
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

from collectors.config import (
    COLLECT_LOCK_PATH,
    COLLECT_LOCK_WAIT_SEC,
    HARD_KILL_SEC,
    OUTER_TIMEOUT_SEC,
    ROUND_CAP_SEC,
    SOURCE_DEADLINE_OVERRIDES,
    DATA_DIR,
    DISABLED_COLLECTORS,
    PERSONS,
    PUBLIC_DATA_DIR,
    ROOT,
    SOURCE_DEADLINE_SEC,
)
from collectors import cna, commentary, council, gn_resolve, google_news, html_news, images, ly, news_sitemap, official_sitemap, polls, ptt, social_import, websites, x_mentions, youtube
from collectors.person_filter import excluded_payload, partition_items, stats_review_fields
from collectors.source_runner import call_with_deadline

TZ = timezone(timedelta(hours=8))

def dedupe(items):
    seen, out = set(), []
    for it in items:
        key = (it.get("person_id"), it.get("url"))
        if not it.get("url") or key in seen:
            continue
        seen.add(key)
        out.append(it)
    return out


def outlet_distribution(items):
    """來源／outlet 分布（count＋share）；整體與每人。補丁 011。"""
    def _pack(subset):
        c = Counter((i.get("source_name") or i.get("platform") or "unknown") for i in subset)
        n = len(subset)
        outlets = {
            k: {"count": v, "share": round((v / n), 4) if n else 0.0}
            for k, v in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))
        }
        return {"total": n, "outlets": outlets}
    by_person = {p["id"]: _pack([i for i in items if i.get("person_id") == p["id"]]) for p in PERSONS}
    return {"overall": _pack(items), "by_person": by_person}

def build_stats(items, comments, source_stats):
    by_person = {}
    now = datetime.now(TZ)
    for p in PERSONS:
        pid = p["id"]
        subset = [i for i in items if i["person_id"] == pid]
        sent = Counter(i.get("sentiment", "neu") for i in subset)
        platforms = Counter(i.get("platform") for i in subset)
        daily = Counter()
        last24 = last7 = 0
        for i in subset:
            ts = i.get("published_at") or i.get("collected_at") or ""
            day = ts[:10] if ts else "unknown"
            if day != "unknown":
                daily[day] += 1
                try:
                    dt = datetime.fromisoformat(ts)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=TZ)
                    age = now - dt.astimezone(TZ)
                    if age.total_seconds() <= 86400:
                        last24 += 1
                    if age.total_seconds() <= 7 * 86400:
                        last7 += 1
                except Exception:
                    pass
        csub = [c for c in comments if c["person_id"] == pid]
        csent = Counter(c.get("sentiment") for c in csub)
        by_person[pid] = {
            "name": p["name"],
            "role": p["role"],
            "party": p["party"],
            "total": len(subset),
            "last_24h": last24,
            "last_7d": last7,
            "sentiment": dict(sent),
            "platforms": dict(platforms),
            "daily_volume": dict(sorted(daily.items())[-14:]),
            "latest": [
                {"title": i.get("title"), "url": i.get("url"), "published_at": i.get("published_at"),
                 "platform": i.get("platform"), "sentiment": i.get("sentiment")}
                for i in subset[:5]
            ],
            "comment_stats": {
                "samples": len(csub),
                "sentiment": dict(csent),
                "excerpts": [
                    {"text": c["text"], "sentiment": c["sentiment"], "url": c["url"], "platform": c["platform"]}
                    for c in csub[:12]
                ],
            },
        }
    # 議題三人對照
    topic_compare = defaultdict(lambda: {p["id"]: 0 for p in PERSONS})
    for i in items:
        for t in i.get("topics") or []:
            topic_compare[t][i["person_id"]] += 1
    return {
        "generated_at": datetime.now(TZ).isoformat(),
        "timezone": "Asia/Taipei",
        "total_items": len(items),
        "by_person": by_person,
        "topics": dict(Counter(t for i in items for t in (i.get("topics") or []))),
        "topic_compare": {k: dict(v) for k, v in topic_compare.items()},
        "source_stats": source_stats,
        "outlet_distribution": outlet_distribution(items),
        "persons": [{"id": p["id"], "name": p["name"], "role": p["role"], "party": p["party"]} for p in PERSONS],
        "disclaimer": (
            "本站自動彙整公開網路與官方開放資料，中立呈現，不代表本站立場。"
            "留言與推文僅顯示不具名短摘錄與統計，不顯示帳號、名字或頭像，不建檔追蹤個人。"
            "請以原文連結為準。"
        ),
    }

def write_outputs(items, stats):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload_items = json.dumps(items, ensure_ascii=False, indent=2)
    payload_stats = json.dumps(stats, ensure_ascii=False, indent=2)
    (DATA_DIR / "items.json").write_text(payload_items, encoding="utf-8")
    (DATA_DIR / "stats.json").write_text(payload_stats, encoding="utf-8")
    (PUBLIC_DATA_DIR / "items.json").write_text(payload_items, encoding="utf-8")
    (PUBLIC_DATA_DIR / "stats.json").write_text(payload_stats, encoding="utf-8")
    by_p = defaultdict(list)
    for it in items:
        by_p[it["person_id"]].append(it)
    for p in PERSONS:
        blob = json.dumps(by_p[p["id"]], ensure_ascii=False, indent=2)
        (DATA_DIR / f"items_{p['id']}.json").write_text(blob, encoding="utf-8")
        (PUBLIC_DATA_DIR / f"items_{p['id']}.json").write_text(blob, encoding="utf-8")

def main() -> int:
    print(
        f"[collect] budget source≤{SOURCE_DEADLINE_SEC}s "
        f"overrides={SOURCE_DEADLINE_OVERRIDES or '{}'} "
        f"ROUND_CAP={ROUND_CAP_SEC}s HARD_KILL≈{HARD_KILL_SEC}s OUTER≈{OUTER_TIMEOUT_SEC}s",
        flush=True,
    )
    source_stats = {}
    all_items, all_comments, poll_records = [], [], []
    collectors = [
        ("google_news", google_news.collect),
        ("cna", cna.collect),
        ("news_sitemap", news_sitemap.collect),  # 各報 robots 明列的 news sitemap（標題＋發布時間＋圖）
        ("html_news", html_news.collect),  # SOURCES_008：竹北／縣府／議會／官網／民進黨／國民黨年目錄
        ("ptt", ptt.collect),
        ("ly", ly.collect),
        ("websites", websites.collect),
        ("sitemap", official_sitemap.collect),  # 補丁 012：官網 sitemap → 本人發言（官網）
        ("council", council.collect),
        ("polls", polls.collect),
        ("commentary", commentary.collect),
        ("x_mentions", x_mentions.collect),
        ("social_import", social_import.collect),
        ("youtube", youtube.collect),
    ]
    # 停用的來源：不再抓取，但沿用上一輪已發布的條目（尚未決定清除；不刪資料）
    prev_items, prev_polls = [], []
    try:
        prev_items = json.loads((DATA_DIR / "items.json").read_text(encoding="utf-8"))
        prev_polls = json.loads((DATA_DIR / "polls.json").read_text(encoding="utf-8"))
    except Exception:
        pass
    carry_hosts = set()
    if DISABLED_COLLECTORS & {"google_news", "polls", "commentary"}:
        carry_hosts.add("news.google.com")
    if "youtube" in DISABLED_COLLECTORS:
        carry_hosts.update({"www.youtube.com", "youtube.com", "youtu.be"})
    from urllib.parse import urlparse as _up
    # 上一輪被分流到待審／排除的完整條目也一併沿用（重新分類；不因分流而永久消失）
    try:
        prev_ex = json.loads((DATA_DIR / "excluded.json").read_text(encoding="utf-8"))
        for e in (prev_ex.get("pending_review") or []) + (prev_ex.get("excluded") or []):
            if isinstance(e, dict) and isinstance(e.get("item"), dict):
                prev_items.append(e["item"])
    except Exception:
        pass
    carried = [i for i in prev_items if _up(str(i.get("url") or "")).netloc in carry_hosts]
    if carried:
        all_items.extend(carried)
        source_stats["carried_forward"] = {"ok": len(carried), "note": "disabled sources, not refetched"}
    if "polls" in DISABLED_COLLECTORS and prev_polls:
        poll_records.extend(prev_polls)
    _round_t0 = time.monotonic()
    for name, fn in collectors:
        if name in DISABLED_COLLECTORS:
            print(f"[collect] {name} disabled (robots.txt)", flush=True)
            source_stats[name] = {"ok": 0, "disabled": "robots.txt"}
            continue
        left = ROUND_CAP_SEC - (time.monotonic() - _round_t0)
        if left <= 15:
            source_stats[name] = {"ok": 0, "error": "round_cap", "skipped_by_deadline": True}
            print(f"[collect] {name} skipped: round cap {ROUND_CAP_SEC}s reached", flush=True)
            continue
        dl = min(float(SOURCE_DEADLINE_OVERRIDES.get(name, SOURCE_DEADLINE_SEC)), left - 10)
        print(f"[collect] {name} ... (deadline {dl:.0f}s)", flush=True)
        packed, health = call_with_deadline(fn, name=name, deadline_sec=dl)
        if health.skipped_by_deadline or packed is None:
            source_stats[name] = {
                "ok": 0,
                "error": health.error,
                "error_kind": health.error_kind,
                "skipped_by_deadline": True,
                "elapsed_sec": health.elapsed_sec,
            }
            print(f"  -> SKIP deadline {health.elapsed_sec:.1f}s {health.error}", flush=True)
            continue
        items, st = packed
        if name in ("ptt", "youtube"):
            all_comments.extend(st.pop("comments", []) or [])
        if name == "polls":
            poll_records.extend(st.pop("polls", []) or [])
        st = dict(st or {})
        st["elapsed_sec"] = health.elapsed_sec
        source_stats[name] = st
        all_items.extend(items or [])
        print(f"  -> {len(items or [])}  {health.elapsed_sec:.1f}s  {st}", flush=True)

    # 012：官網 sitemap 本輪失敗／逾時 → 沿用上一輪的本人發言（官網）條目（不因一次失敗消失）
    sm = source_stats.get("sitemap") or {}
    if sm.get("skipped_by_deadline") or sm.get("error"):
        prev_off = [i for i in prev_items if i.get("source_type") == "official_statement"]
        all_items.extend(prev_off)
        sm["carried_forward"] = len(prev_off)

    items = dedupe(all_items)
    items.sort(key=lambda i: i.get("published_at") or i.get("collected_at") or "", reverse=True)
    # 新鮮度：記錄每筆「首次看到」時間（沿用上一輪值；collected_at 每輪都會被覆寫，無法量延遲）
    try:
        _new_n = images.stamp_first_seen(items, prev_items)
        print(f"[collect] first_seen_at: {_new_n} new item(s)", flush=True)
    except Exception as ex:  # noqa: BLE001  不擋整輪
        print(f"[collect] first_seen_at skipped: {ex}", flush=True)
    # FILTER_007：hard→excluded；soft_review→pending；keep／soft_downrank→主軸＋統計
    kept, pending, excluded = partition_items(items)
    # 縮圖網址（og:image 等；只存 URL）：每輪有筆數／牆鐘預算，最新的先；快取在 repo 之外（HSINCHU_IMAGE_CACHE_PATH）
    try:
        _left = ROUND_CAP_SEC - (time.monotonic() - _round_t0)
        if _left > 40:
            source_stats["images"] = images.enrich_items(
                kept, deadline_sec=min(images.DEFAULT_DEADLINE_SEC, _left - 30))
            print(f"[collect] images: {source_stats['images']}", flush=True)
        else:
            source_stats["images"] = {"skipped": "round_cap"}
    except Exception as ex:  # noqa: BLE001
        source_stats["images"] = {"error": str(ex)[:120]}
        print(f"[collect] images failed (non-blocking): {ex}", flush=True)
    # Google News → 原文（標題對 sitemap／RSS；從不跟隨 news.google.com）
    try:
        _left = ROUND_CAP_SEC - (time.monotonic() - _round_t0)
        if _left > 50:
            source_stats["gn_resolve"] = gn_resolve.resolve_items(kept, fetch_missing_og=True, og_budget=20)
            source_stats["gov_images"] = gn_resolve.resolve_gov_images(kept, budget=12)
            print(f"[collect] gn_resolve: {source_stats['gn_resolve']} gov={source_stats['gov_images']}", flush=True)
            # 對新換成原文、尚無圖者再跑一輪小預算 og
            source_stats["images_after_resolve"] = images.enrich_items(
                kept, budget=16, deadline_sec=min(20.0, _left - 40))
        else:
            source_stats["gn_resolve"] = {"skipped": "round_cap"}
    except Exception as ex:  # noqa: BLE001
        source_stats["gn_resolve"] = {"error": str(ex)[:120]}
        print(f"[collect] gn_resolve failed (non-blocking): {ex}", flush=True)
    # 補丁 008：官網蒐集端已判定的非文章頁併入 excluded（若尚未被 partition 收錄）
    seen_ex_urls = {str((e.get("item") or e).get("url") or "") for e in excluded}
    for e in (source_stats.get("websites") or {}).pop("excluded_official", []) or []:
        u = str((e.get("item") or e).get("url") or e.get("url") or "")
        if u and u in seen_ex_urls:
            continue
        excluded.append(e)
        if u:
            seen_ex_urls.add(u)
    stats = build_stats(kept, all_comments, source_stats)
    stats["polls"] = poll_records
    downrank_n = sum(1 for i in kept if i.get("downrank"))
    stats.update(stats_review_fields(len(pending), downrank_n))
    stats["excluded_ingest"] = {
        "count": len(excluded),
        "reasons": {r: sum(1 for e in excluded if e.get("reason") == r)
                    for r in sorted({e.get("reason") for e in excluded})},
    }
    print(
        f"[collect] writing outputs (ROUND_CAP={ROUND_CAP_SEC}s elapsed guard done; finalize next)",
        flush=True,
    )
    write_outputs(kept, stats)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    from collectors.util import now_tw
    excl_doc = excluded_payload(excluded, finalized_at=now_tw(), pending=pending)
    (DATA_DIR / "excluded.json").write_text(
        json.dumps(excl_doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DATA_DIR / "polls.json").write_text(json.dumps(poll_records, ensure_ascii=False, indent=2), encoding="utf-8")
    (PUBLIC_DATA_DIR / "polls.json").write_text(json.dumps(poll_records, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n=== SUMMARY ===", flush=True)
    for k, v in source_stats.items():
        print(f"{k}: {v}", flush=True)
    print(
        f"deduped={len(items)} kept={len(kept)} pending={len(pending)} excluded={len(excluded)} "
        f"downrank={downrank_n} -> {DATA_DIR} & {PUBLIC_DATA_DIR}",
        flush=True,
    )
    # 發布前整理：錯人過濾、民調標示／封關、URL 去重統計、latest/manifest
    import runpy
    runpy.run_path(str(ROOT / "scripts" / "finalize_data.py"), run_name="finalize")["main"]()
    return 0

def _apply_dir_args(argv) -> None:
    """--data-dir／--public-data-dir：導向暫存目錄（同時設環境變數，finalize 亦讀）。"""
    global DATA_DIR, PUBLIC_DATA_DIR
    import os
    from pathlib import Path as _P
    for flag, env in (("--data-dir", "HSINCHU_DATA_DIR"), ("--public-data-dir", "HSINCHU_PUBLIC_DATA_DIR")):
        if flag in argv and argv.index(flag) + 1 < len(argv):
            os.environ[env] = argv[argv.index(flag) + 1]
    if os.environ.get("HSINCHU_DATA_DIR"):
        DATA_DIR = _P(os.environ["HSINCHU_DATA_DIR"])
    if os.environ.get("HSINCHU_PUBLIC_DATA_DIR"):
        PUBLIC_DATA_DIR = _P(os.environ["HSINCHU_PUBLIC_DATA_DIR"])


def _lock_wait_sec() -> float:
    import os
    raw = os.environ.get("HSINCHU_COLLECT_LOCK_WAIT_SEC")
    if raw:
        try:
            return float(raw)
        except ValueError:
            pass
    return float(COLLECT_LOCK_WAIT_SEC)


def _lock_path() -> str:
    """鎖路徑：環境變數 HSINCHU_COLLECT_LOCK 優先（測試用暫存檔），否則 COLLECT_LOCK_PATH。"""
    import os
    return (os.environ.get("HSINCHU_COLLECT_LOCK") or COLLECT_LOCK_PATH).strip()


def _read_lock_holder_pid(lock_path: str) -> str | None:
    """讀鎖檔內寫入的持有者 PID（best-effort；非核心安全機制）。"""
    try:
        text = Path(lock_path).read_text(encoding="utf-8").strip()
        if not text:
            return None
        # 檔案格式：首行 PID
        tok = text.split()[0]
        if tok.isdigit():
            return tok
    except Exception:
        return None
    return None


def acquire_collect_lock(lock_path: str | None = None, wait_sec: float | None = None):
    """嘗試取得 collect.lock（非阻塞重試至 wait_sec）。

    成功回傳已持鎖的 file object（呼叫端須 unlock／close）；
    逾時回傳 None，並已 print 清楚訊息（可能為呼叫端或其他 run 持鎖）。

    【呼叫端不可再持 collect.lock】——見模組 docstring（009 r2／01:25 巢狀死鎖）。
    """
    import fcntl
    import os
    import time

    path = lock_path or _lock_path()
    wait = float(_lock_wait_sec() if wait_sec is None else wait_sec)
    holder = _read_lock_holder_pid(path)
    holder_note = f", lock file PID={holder}" if holder else ""
    print(
        f"[collect] acquiring lock {path} (wait≤{wait:.0f}s)"
        f"{holder_note} — 呼叫端不可再持 collect.lock",
        flush=True,
    )
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    # a+/r+：勿用 "w" 截斷，才能讀到既有持有者 PID
    Path(path).touch(exist_ok=True)
    fh = open(path, "r+", encoding="utf-8")
    deadline = time.monotonic() + wait
    try:
        while True:
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                left = deadline - time.monotonic()
                if left <= 0:
                    holder2 = _read_lock_holder_pid(path) or holder
                    print(
                        "[collect] LOCK timeout — skip round. "
                        "鎖可能仍由「呼叫端外層 wrapper」或其他 collect run 持有"
                        f"{('（PID ' + holder2 + '）') if holder2 else ''}；"
                        "呼叫端不可再持 collect.lock（會巢狀死鎖，見 01:25）。",
                        flush=True,
                    )
                    fh.close()
                    return None
                time.sleep(min(0.5, max(left, 0.05)))
        # 寫入本行程 PID，供下一個等待者診斷
        try:
            fh.seek(0)
            fh.truncate()
            fh.write(f"{os.getpid()}\n")
            fh.flush()
        except Exception:
            pass
        print(f"[collect] lock acquired pid={os.getpid()} path={path}", flush=True)
        return fh
    except Exception:
        try:
            fh.close()
        except Exception:
            pass
        raise


def release_collect_lock(fh) -> None:
    import fcntl
    if fh is None:
        return
    try:
        fcntl.flock(fh, fcntl.LOCK_UN)
    except Exception:
        pass
    try:
        fh.close()
    except Exception:
        pass


def _locked_main() -> int:
    """與部署協調：持有 collect.lock 期間，build_snapshot 不會複製 data/。

    補丁 009：鎖等待有上限（COLLECT_LOCK_WAIT_SEC），並先 flush 日誌。
    補丁 009 r2：【呼叫端不可再持 collect.lock】——外層再 flock 同一路徑會巢狀死鎖
    （柏能確認 01:25 原因；01:51 無外層鎖則 16s 完成）。
    """
    import sys
    _apply_dir_args(sys.argv[1:])
    if DATA_DIR.resolve() != (ROOT / "data").resolve():
        # safe_collect 暫存模式：不碰正式 data/，不持 collect lock（換入由 safe_collect 在鎖內做）
        print(f"[collect] staging mode -> {DATA_DIR} (no collect lock)", flush=True)
        return main()
    # 正式 data/：本模組內部取鎖。呼叫端不可再持 collect.lock。
    fh = acquire_collect_lock()
    if fh is None:
        return 2
    try:
        return main()
    finally:
        release_collect_lock(fh)


if __name__ == "__main__":
    import os as _os
    import sys as _sys
    _rc = _locked_main()
    _sys.stdout.flush()
    _sys.stderr.flush()
    # 逾時來源的背景執行緒可能仍卡在網路讀取；ThreadPoolExecutor 會在直譯器結束時 join 它們。
    # 資料已寫完，直接結束行程，不讓卡住的執行緒拖住本輪。
    _os._exit(int(_rc or 0))
