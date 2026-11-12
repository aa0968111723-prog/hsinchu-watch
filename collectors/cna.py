# -*- coding: utf-8 -*-
"""允許清單 RSS／Atom 收集（中央社 Atom、UDN 地方／意見、鏡週刊）。

補丁 011-udn-local：納入 UDN 地方完整 feed（news/rssfeed/6641）；短回應警示
udn_short_feed；全名＋low_local；禮貌間隔；沿用 009 timeout／SESSION。
仍硬拒：Feedburner、自由、YouTube、Google News。
"""
from __future__ import annotations

import logging
import time
from typing import Any, Callable, Optional

import feedparser

from collectors.config import (
    CNA_FEEDS,
    FEED_FETCH_INTERVAL_SEC,
    PERSONS,
    REQUEST_TIMEOUT,
    UDN_SHORT_FEED_MAX,
)
from collectors.httputil import normalize_timeout
from collectors.images import feed_entry_image
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item, parse_rss_date, session, strip_html

log = logging.getLogger(__name__)

# FILTER_DECISION §2.1 GEO_ALLOW；§2.2 GEO_SOFT（裸「新竹」）
GEO_ALLOW = (
    "新竹縣", "竹北", "新竹縣政府", "新竹縣議會", "縣政", "竹科", "科學園區",
    "湖口", "新豐", "芎林", "關西", "橫山", "北埔", "峨眉", "寶山",
    "竹東", "尖石", "五峰", "新埔",
)
GEO_SOFT = ("新竹",)

# robots／政策不允許：硬拒（即使誤設進 CNA_FEEDS）
BLOCKED_HOSTS = (
    "youtube.com", "youtu.be", "news.google.com", "news.ltn.com.tw",
    "feeds.feedburner.com", "feedburner.com",
)
BLOCKED_PATHS = (("upmedia.mg", "/news_list.php"), ("www.cna.com.tw", "/rss/"))

# 已知短訊變體（勿當完整地方源）
UDN_LOCAL_SHORT_URL = "https://udn.com/rssfeed/news/2/6641?ch=news"
UDN_LOCAL_FULL_URL = "https://udn.com/news/rssfeed/6641"


def is_blocked(url: str) -> bool:
    from urllib.parse import urlparse
    u = urlparse(url)
    host, path = (u.netloc or "").lower(), u.path or ""
    if any(host == h or host.endswith("." + h) for h in BLOCKED_HOSTS):
        return True
    return any(host.endswith(h) and path.startswith(pp) for h, pp in BLOCKED_PATHS)


def has_local_geo(blob: str) -> bool:
    if any(t in blob for t in GEO_ALLOW):
        return True
    return any(t in blob for t in GEO_SOFT)


def _outlet_bucket(items: list[dict]) -> dict[str, Any]:
    """Per-outlet counts + share（整體與每人）；供前端來源分布。"""
    from collections import Counter

    def _pack(subset: list[dict]) -> dict[str, Any]:
        c = Counter((i.get("source_name") or i.get("platform") or "unknown") for i in subset)
        n = len(subset)
        out = {}
        for k, v in sorted(c.items(), key=lambda kv: (-kv[1], kv[0])):
            out[k] = {
                "count": v,
                "share": round((v / n), 4) if n else 0.0,
            }
        return {"total": n, "outlets": out}

    by_person = {}
    for p in PERSONS:
        by_person[p["id"]] = _pack([i for i in items if i.get("person_id") == p["id"]])
    return {"overall": _pack(items), "by_person": by_person}


def collect(
    *,
    fetch_bytes: Optional[Callable[[str], bytes]] = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> tuple[list[dict], dict]:
    """收集允許 feed。

    fetch_bytes：測試可注入（url → raw XML bytes），略過網路。
    """
    sess = None if fetch_bytes else session()
    items: list[dict] = []
    stats: dict[str, Any] = {
        "ok": 0,
        "error": None,
        "raw": 0,
        "feeds": {},
        "feed_entry_counts": {},
        "warnings": [],
        "outlet_distribution": None,
    }
    errors: list[str] = []
    first = True

    for spec in CNA_FEEDS:
        feed_id, url = spec[0], spec[1]
        source_name = spec[2] if len(spec) > 2 else "中央社"
        platform = spec[3] if len(spec) > 3 else "news"
        if is_blocked(url):
            stats["feeds"][feed_id] = "blocked:robots"
            continue
        # 防誤用短訊 URL
        if feed_id == "udn_local" and "rssfeed/news/2/6641" in url:
            stats["feeds"][feed_id] = "blocked:short_variant"
            stats["warnings"].append({
                "code": "udn_short_feed",
                "feed_id": feed_id,
                "entry_count": None,
                "url": url,
                "note": "refused short URL variant; use news/rssfeed/6641",
            })
            log.warning("udn_short_feed refused short URL variant count=None url=%s", url)
            continue

        if not first:
            sleep_fn(float(FEED_FETCH_INTERVAL_SEC))
        first = False

        try:
            if fetch_bytes is not None:
                content = fetch_bytes(url)
            else:
                assert sess is not None
                r = sess.get(url, timeout=normalize_timeout(REQUEST_TIMEOUT))
                r.raise_for_status()
                content = r.content
            feed = feedparser.parse(content)
            entry_count = len(feed.entries)
            stats["feed_entry_counts"][feed_id] = entry_count

            # 短 feed 警示（不失敗）：UDN 地方完整源預期遠高於門檻
            if feed_id == "udn_local" and entry_count <= int(UDN_SHORT_FEED_MAX):
                w = {
                    "code": "udn_short_feed",
                    "feed_id": feed_id,
                    "entry_count": entry_count,
                    "threshold": int(UDN_SHORT_FEED_MAX),
                    "url": url,
                }
                stats["warnings"].append(w)
                log.warning(
                    "udn_short_feed entry_count=%s threshold=%s url=%s",
                    entry_count, UDN_SHORT_FEED_MAX, url,
                )

            n = 0
            for e in feed.entries:
                stats["raw"] += 1
                title = strip_html(getattr(e, "title", "") or "")
                summary_full = strip_html(getattr(e, "summary", "") or "")
                blob = f"{title} {summary_full}"
                summary = summary_full[:30]  # 不存全文：摘要 ≤30 字
                low_local = not has_local_geo(blob)
                entry_img = feed_entry_image(e)  # 來源 feed 自帶圖（如鏡週刊 enclosure）；沒有就不加欄位
                for person in [p for p in PERSONS if p["name"] in blob]:
                    items.append(make_item(
                        person=person, platform=platform, source_name=source_name,
                        url=getattr(e, "link", "") or "", title=title, summary=summary,
                        published_at=parse_rss_date(
                            getattr(e, "published", None) or getattr(e, "updated", None)
                        ),
                        is_own_speech=False, sentiment_fn=score_sentiment, topics_fn=tag_topics,
                        extra={"low_local": low_local, "feed_id": feed_id, **({"image_url": entry_img} if entry_img else {})},
                    ))
                    n += 1
            stats["feeds"][feed_id] = n
        except Exception as ex:
            errors.append(f"{feed_id}:{ex}")
            stats["feeds"][feed_id] = f"error:{ex}"

    stats["ok"] = len(items)
    stats["outlet_distribution"] = _outlet_bucket(items)
    if errors:
        stats["error"] = "; ".join(errors)
    return items, stats
