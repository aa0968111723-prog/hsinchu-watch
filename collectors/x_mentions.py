# -*- coding: utf-8 -*-
"""X（Twitter）貼文匯入：讀檔，不呼叫任何 X API／不抓 x.com（x.com robots 對一般爬蟲 Disallow）。

由上游（主代理以自己的 X 工具取回公開貼文）把 JSON 丟到 /workspace/hsinchu-watch-backups/inbox/x_posts_*.json（repo 之外）：
  list 或 {"posts": [...]}；每筆欄位 id,url,text,author_handle,created_at,image_url,candidate,metrics。
可選 同資料夾 x_official_handles.json：[{"handle": "xxx", "kind": "candidate|media", "name": "顯示名稱", "candidate": "xu"}]
  — 只有名單內的帳號才會顯示帳號／全文；其餘一律匿名化。

驗證與隱私規則：
- 必須有 http(s) 原文連結，且為 x.com／twitter.com 的 /<handle>/status/<數字id>，id 與 url 一致；否則丟棄。
- candidate 必須是 wu／xu／zheng（或全名），且文字含該人全名（站規）；否則丟棄。
- 以 id 去重（跨檔）。
- 非官方／非媒體帳號：不存 handle；連結改為 https://x.com/i/status/<id>（不含帳號）；文字只留 ≤30 字、
  去掉 @提及與網址；不存姓名。metrics 只留數字統計。
- 候選人官方帳號：source_type=official_social、counts_in_stats=False（與官網本人發言同規）。
- 媒體帳號：以媒體名為 source_name，一般計入。
- 圖：只收 https 網址（image_url），不下載。
輸出條目不含任何 author／handle 欄位。
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from collectors.config import PERSONS, ROOT
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item

TZ = timezone(timedelta(hours=8))
NAME_TO_ID = {p["name"]: p["id"] for p in PERSONS}
BY_ID = {p["id"]: p for p in PERSONS}
URL_RE = re.compile(r"^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})/status/(\d{5,25})(?:[/?#].*)?$")
IURL_RE = re.compile(r"^https?://(?:www\.)?(?:x|twitter)\.com/i/(?:web/)?status/(\d{5,25})(?:[/?#].*)?$")
MENTION_RE = re.compile(r"@[A-Za-z0-9_]{1,15}")
LINK_RE = re.compile(r"https?://\S+")
METRIC_KEYS = ("like_count", "retweet_count", "reply_count", "quote_count", "impression_count", "bookmark_count",
               "likes", "reposts", "replies", "quotes", "views")
# 原始收件匣放在 repo 之外（含 handle 的原檔不得進 repo／部署掃描）；只把去識別後的條目寫進 data/
DEFAULT_INBOX = Path("/workspace/hsinchu-watch-backups/inbox")
# 預設空：不憑猜測列官方帳號。由 inbox/x_official_handles.json 提供。
DEFAULT_OFFICIAL: Dict[str, Dict[str, str]] = {}


def inbox_dir() -> Path:
    return Path(os.environ.get("HSINCHU_X_INBOX") or DEFAULT_INBOX)


def load_official(inbox: Path) -> Dict[str, Dict[str, str]]:
    out = dict(DEFAULT_OFFICIAL)
    p = inbox / "x_official_handles.json"
    try:
        for r in json.loads(p.read_text(encoding="utf-8")):
            h = str(r.get("handle") or "").lstrip("@").lower()
            if h and r.get("kind") in ("candidate", "media"):
                out[h] = {"kind": r["kind"], "name": str(r.get("name") or h), "candidate": str(r.get("candidate") or "")}
    except Exception:  # noqa: BLE001
        pass
    return out


def parse_time(v: Any) -> Optional[str]:
    if not v:
        return None
    try:
        s = str(v).strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(TZ).isoformat()
    except Exception:  # noqa: BLE001
        return None


def clean_image(u: Any) -> Optional[str]:
    u = str(u or "").strip()
    return u if re.match(r"^https://[^\s]{4,500}$", u) else None


def person_of(rec: dict) -> Optional[dict]:
    c = str(rec.get("candidate") or "").strip()
    pid = c if c in BY_ID else NAME_TO_ID.get(c)
    return BY_ID.get(pid) if pid else None


def anonymize(text: str) -> str:
    t = LINK_RE.sub("", MENTION_RE.sub("", text or ""))
    t = re.sub(r"^\s*RT\s*:?\s*", "", t)
    return re.sub(r"\s+", " ", t).strip()[:30]


def metrics_of(m: Any) -> Optional[Dict[str, int]]:
    if not isinstance(m, dict):
        return None
    out = {k: int(v) for k, v in m.items() if k in METRIC_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool)}
    return out or None


def import_posts(posts: List[dict], official: Dict[str, Dict[str, str]], stats: Dict[str, Any], seen: set):
    items = []
    rej = stats.setdefault("rejected", {})

    def bad(reason):
        rej[reason] = rej.get(reason, 0) + 1

    for rec in posts:
        if not isinstance(rec, dict):
            bad("not_object")
            continue
        url = str(rec.get("url") or "").strip()
        m = URL_RE.match(url)
        mi = IURL_RE.match(url)
        if not (m or mi):
            bad("bad_url")
            continue
        sid = m.group(2) if m else mi.group(1)
        if rec.get("id") is not None and str(rec["id"]) != sid:
            bad("id_url_mismatch")
            continue
        if sid in seen:
            bad("duplicate")
            continue
        person = person_of(rec)
        text = str(rec.get("text") or "")
        if not person:
            bad("unknown_candidate")
            continue
        if person["name"] not in text:
            bad("name_absent")
            continue
        handle = (m.group(1).lower() if m else str(rec.get("author_handle") or "").lstrip("@").lower())
        off = official.get(handle)
        seen.add(sid)
        common_extra = {"type": "x", "x_status_id": sid, "image_url": clean_image(rec.get("image_url")),
                        "engagement": metrics_of(rec.get("metrics"))}
        pub = parse_time(rec.get("created_at"))
        if off:
            # 官方／媒體：可顯示名稱與全文（≤200 字標題）
            canon = f"https://x.com/i/status/{sid}"  # 一律不帶帳號路徑（掃描／隱私一致）；官方名稱放 source_name
            if off["kind"] == "candidate":
                extra = {**common_extra, "source_type": "official_social", "display_label": "本人發言（官方 X）",
                         "counts_in_stats": False, "date_source": "x" if pub else "unknown"}
                own = True
            else:
                extra, own = common_extra, False
            it = make_item(person=person, platform="x", source_name=f"X｜{off['name']}", url=canon,
                           title=text[:200], summary="", published_at=pub, is_own_speech=own,
                           sentiment_fn=score_sentiment, topics_fn=tag_topics, extra=extra)
        else:
            ex = anonymize(text)
            if person["name"] not in ex:
                # 30 字內須仍含全名（站規：每則含全名）；否則改以「含全名的 30 字視窗」
                i = text.find(person["name"])
                ex = anonymize(text[max(0, i - 8):])
                if person["name"] not in ex:
                    bad("excerpt_lost_name")
                    seen.discard(sid)
                    continue
            canon = f"https://x.com/i/status/{sid}"
            it = make_item(person=person, platform="x", source_name="X（公開貼文）", url=canon, title=ex, summary="",
                           published_at=pub, is_own_speech=False, sentiment_fn=score_sentiment, topics_fn=tag_topics,
                           extra={**common_extra, "anonymous_excerpt": ex, "anonymized": True})
        items.append(it)
    return items


def collect():
    inbox = inbox_dir()
    files = sorted(inbox.glob("x_posts_*.json")) if inbox.is_dir() else []
    stats: Dict[str, Any] = {"ok": 0, "error": None, "files": len(files), "inbox": "outside-repo", "skipped": not files}
    if not files:
        stats["reason"] = "收件匣無 x_posts_*.json"
        return [], stats
    official = load_official(inbox)
    seen: set = set()
    items: List[dict] = []
    for f in files:
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            stats.setdefault("rejected", {})["bad_file"] = stats.get("rejected", {}).get("bad_file", 0) + 1
            continue
        posts = doc.get("posts") if isinstance(doc, dict) else doc
        if isinstance(posts, list):
            items.extend(import_posts(posts, official, stats, seen))
    stats["ok"] = len(items)
    stats["official_handles_known"] = len(official)
    per = {}
    for p in PERSONS:
        mine = sorted([i["published_at"] for i in items if i["person_id"] == p["id"] and i.get("published_at")], reverse=True)
        per[p["id"]] = {"items": sum(1 for i in items if i["person_id"] == p["id"]), "newest_published_at": mine[0] if mine else None}
    stats["per_person"] = per
    return items, stats
