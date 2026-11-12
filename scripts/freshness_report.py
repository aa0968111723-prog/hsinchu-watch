#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""新鮮度報告（唯讀；不發請求，除非加 --probe）。

1) 每個來源：發布時間 → 首次看到（first_seen_at）的延遲（中位／P90／最大），只算 first_seen_at 有值的條目
   （first_seen_at 於 2026-11-10 06:30 起才記錄；更早的條目是 null，不納入）。
2) 每輪蒐集日誌：耗時、是否部署、原因（work/柏能/collect_*.log 的 `[round] summary`）。
3) 圖片覆蓋率：image_url 有值的比例（依來源）。
4) --probe：對允許清單 feed 各發一次 GET，看「來源自己最新一則多久以前」（來源端延遲）。

用法：python3 scripts/freshness_report.py [--data data/items.json] [--hours 24] [--logs 12] [--probe]
"""
from __future__ import annotations

import argparse
import glob
import json
import re
import statistics
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
TZ = timezone(timedelta(hours=8))


def _dt(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(s)
        return d if d.tzinfo else d.replace(tzinfo=TZ)
    except Exception:
        return None


def src_key(i):
    return i.get("feed_id") or i.get("source_name") or urlparse(i.get("url", "")).netloc


def pct(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(round((len(v) - 1) * p)))] if v else None


def lag_table(items, hours):
    now = datetime.now(TZ)
    by = defaultdict(list)
    for i in items:
        fs, pa = _dt(i.get("first_seen_at")), _dt(i.get("published_at"))
        if not fs or not pa or now - fs > timedelta(hours=hours):
            continue
        by[src_key(i)].append(max(0.0, (fs - pa).total_seconds() / 60))
    rows = []
    for k, v in sorted(by.items(), key=lambda kv: -len(kv[1])):
        rows.append({"source": k, "n": len(v), "median_min": round(statistics.median(v), 1),
                     "p90_min": round(pct(v, 0.9), 1), "max_min": round(max(v), 1)})
    return rows


def image_table(items):
    by = defaultdict(lambda: [0, 0])
    for i in items:
        k = src_key(i)
        by[k][0] += 1
        by[k][1] += 1 if i.get("image_url") else 0
    return {k: {"items": a, "with_image": b} for k, (a, b) in sorted(by.items(), key=lambda kv: -kv[1][0])}


def round_logs(n):
    out = []
    for f in sorted(glob.glob(str(ROOT / "work" / "柏能" / "collect_*.log")), key=lambda p: Path(p).stat().st_mtime)[-n:]:
        t = Path(f).read_text(encoding="utf-8", errors="replace")
        m = re.search(r"\[round\] summary result=(\S+) reason=(\S+) deploy=(\S+) ec=(\d+) elapsed=(\d+)s", t)
        st = re.search(r"\[round\] start (\S+ \S+)", t)
        if m:
            out.append({"log": Path(f).name, "start": st.group(1) if st else None, "result": m.group(1),
                        "reason": m.group(2), "deploy": m.group(3), "elapsed_s": int(m.group(5))})
    return out


def probe():
    import sys
    sys.path.insert(0, str(ROOT))
    import feedparser
    from collectors.config import CNA_FEEDS, PTT_BOARDS
    from collectors.httputil import make_session
    s, rows = make_session(), []
    for spec in list(CNA_FEEDS) + [(f"ptt_{b[0]}", b[1]) for b in PTT_BOARDS]:
        try:
            r = s.get(spec[1])
            ds = []
            for e in feedparser.parse(r.content).entries:
                p = getattr(e, "published_parsed", None) or getattr(e, "updated_parsed", None)
                if p:
                    ds.append(datetime(*p[:6], tzinfo=timezone.utc))
            ds.sort(reverse=True)
            now = datetime.now(timezone.utc)
            rows.append({"feed": spec[0], "http": r.status_code, "entries": len(ds),
                         "newest_age_min": round((now - ds[0]).total_seconds() / 60) if ds else None,
                         "window_h": round((now - ds[-1]).total_seconds() / 3600, 1) if ds else None})
        except Exception as ex:  # noqa: BLE001
            rows.append({"feed": spec[0], "error": str(ex)[:80]})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(ROOT / "data" / "items.json"))
    ap.add_argument("--hours", type=float, default=24)
    ap.add_argument("--logs", type=int, default=12)
    ap.add_argument("--probe", action="store_true")
    a = ap.parse_args()
    items = json.loads(Path(a.data).read_text(encoding="utf-8"))
    out = {"generated_at": datetime.now(TZ).isoformat(timespec="seconds"), "items": len(items),
           "with_first_seen_at": sum(1 for i in items if i.get("first_seen_at")),
           "lag_published_to_first_seen": lag_table(items, a.hours),
           "images": image_table(items), "recent_rounds": round_logs(a.logs)}
    if a.probe:
        out["feed_probe"] = probe()
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
