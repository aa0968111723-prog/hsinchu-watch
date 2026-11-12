# -*- coding: utf-8 -*-
"""新聞網站「Google News 站台地圖」（robots.txt 內明列 Sitemap: 的公開 XML）收集。

為什麼：RSS 允許清單只有 4 個 feed（CNA 精選 atom 約每小時 2 則、UDN、鏡週刊、已停更的 UDN 意見）。
各報自己在 robots.txt 宣告的 news sitemap 含「標題＋發布時間（＋圖）」，通常是最近 48 小時，比 RSS 即時又完整，
而且不經 Google News（Google News 的 /rss 被其 robots 禁止，維持停用）。

規則：
- 只用 robots.txt 內 `Sitemap:` 明列的網址；抓之前仍以該主機 robots 檢查 can_fetch。取不到 robots／Disallow → 不抓。
- 每站每輪 1 次 GET（≤3MB），站間隔 1s；不抓文章頁；只存標題／連結／發布時間／圖片網址（不存正文）。
- 姓名過濾：標題含三人全名（與 RSS 路徑同一規則；三人使用同一組來源，不因政黨增減報系）。
- 最新一則超過 48h 沒更新的 sitemap 視為停更，略過並記 stale（例：ETtoday 的 news-sitemap 目前停在 7 月）。
"""
from __future__ import annotations

import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional
from urllib import robotparser
from urllib.parse import urlparse

from collectors.config import PERSONS, USER_AGENT
from collectors.images import clean_image_url, is_generic_image
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item, session, to_iso_tw

TZ = timezone(timedelta(hours=8))
MAX_BYTES = 3 * 1024 * 1024
STALE_HOURS = 48
INTERVAL_SEC = 1.0
# (id, sitemap_url, 顯示用來源名)；每個網址都出自該站 robots.txt 的 Sitemap: 行（2026-11-10 核對）
SOURCES = [
    ("cna_gn", "https://www.cna.com.tw/GoogleNewsSitemap_fromRemote_cfp.xml", "中央社"),
    ("chinatimes_today", "https://www.chinatimes.com/sitemaps/sitemap_todaynews.xml", "中國時報"),
    ("nownews_daily", "https://www.nownews.com/newsSitemap-daily.xml", "NOWnews"),
    ("setn_gn", "https://www.setn.com/sitemapGoogleNews.xml", "三立新聞網"),
    ("mirror_news", "https://www.mirrormedia.mg/rss/posts-news.xml", "鏡週刊"),
    ("ettoday_news", "https://www.ettoday.net/news-sitemap.xml", "ETtoday新聞雲"),  # 目前停更 → 會被 stale 規則略過
]


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_news_sitemap(xml_bytes: bytes) -> list[dict]:
    """→ [{loc, title, published_at(ISO,+08), image}]；壞 XML 回 []。"""
    out: list[dict] = []
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return out
    for url in root.iter():
        if _local(url.tag) != "url":
            continue
        rec: dict[str, Optional[str]] = {"loc": None, "title": None, "pub": None, "image": None}
        for el in url.iter():
            n, txt, is_img = _local(el.tag), (el.text or "").strip(), "image" in el.tag.lower()
            if n == "loc" and is_img:
                rec["image"] = rec["image"] or txt
            elif n == "loc" and rec["loc"] is None:
                rec["loc"] = txt
            elif n == "title" and rec["title"] is None:
                rec["title"] = txt
            elif n == "publication_date" and rec["pub"] is None:
                rec["pub"] = txt
        if rec["loc"] and rec["title"]:
            pub = None
            if rec["pub"]:
                try:
                    d = datetime.fromisoformat(rec["pub"].replace("Z", "+00:00"))
                    pub = to_iso_tw(d if d.tzinfo else d.replace(tzinfo=TZ))
                except Exception:
                    pub = None
            out.append({"loc": rec["loc"], "title": rec["title"], "published_at": pub, "image": rec["image"]})
    return out


def _robots_ok(sess, url: str, cache: dict, fetch_text: Optional[Callable[[str], tuple[int, str]]]) -> bool:
    p = urlparse(url)
    host = f"{p.scheme}://{p.netloc}"
    if host not in cache:
        rp = robotparser.RobotFileParser()
        try:
            if fetch_text:
                code, text = fetch_text(host + "/robots.txt")
            else:
                r = sess.get(host + "/robots.txt", timeout=(5, 10))
                code, text = r.status_code, r.text
            if code == 200:
                rp.parse(text.splitlines())
            elif 400 <= code < 500:
                rp.parse([])
            else:
                rp.parse(["User-agent: *", "Disallow: /"])
        except Exception:
            rp.parse(["User-agent: *", "Disallow: /"])
        cache[host] = rp
    rp = cache[host]
    return rp.can_fetch(USER_AGENT, url) and rp.can_fetch("*", url)


def collect(*, fetch_bytes: Optional[Callable[[str], bytes]] = None,
            fetch_robots: Optional[Callable[[str], tuple[int, str]]] = None,
            sources=None, sleep_fn: Callable[[float], None] = time.sleep,
            now: Optional[datetime] = None) -> tuple[list[dict], dict]:
    from collectors.cna import has_local_geo
    sources = SOURCES if sources is None else sources
    now = now or datetime.now(TZ)
    sess = None if fetch_bytes else session()
    items: list[dict] = []
    stats: dict[str, Any] = {"ok": 0, "error": None, "sources": {}}
    errors: list[str] = []
    robots_cache: dict = {}
    first = True
    for sid, url, name in sources:
        if not _robots_ok(sess, url, robots_cache, fetch_robots):
            stats["sources"][sid] = "blocked:robots"
            continue
        if not first:
            sleep_fn(INTERVAL_SEC)
        first = False
        try:
            if fetch_bytes:
                body = fetch_bytes(url)
            else:
                r = sess.get(url, timeout=(5, 20))
                r.raise_for_status()
                body = r.content[:MAX_BYTES]
            rows = parse_news_sitemap(body)
            pubs = [datetime.fromisoformat(x["published_at"]) for x in rows if x["published_at"]]
            if not rows or not pubs:
                stats["sources"][sid] = "empty"
                continue
            newest = max(pubs)
            if now - newest > timedelta(hours=STALE_HOURS):
                stats["sources"][sid] = f"stale:{newest.date().isoformat()}"
                continue
            n = 0
            for row in rows:
                title = row["title"]
                for person in [p for p in PERSONS if p["name"] in title]:
                    img = clean_image_url(row.get("image"))
                    extra = {"low_local": not has_local_geo(title), "feed_id": sid}
                    if img and not is_generic_image(img):
                        extra["image_url"] = img
                    items.append(make_item(
                        person=person, platform="news", source_name=name,
                        url=row["loc"], title=title, summary="", published_at=row["published_at"],
                        is_own_speech=False, sentiment_fn=score_sentiment, topics_fn=tag_topics, extra=extra))
                    n += 1
            stats["sources"][sid] = {"matched": n}  # 不放 entries／newest：每次都變，會讓內容雜湊每輪抖動、無法跳過部署
        except Exception as ex:  # noqa: BLE001
            errors.append(f"{sid}:{ex}")
            stats["sources"][sid] = f"error:{str(ex)[:60]}"
    stats["ok"] = len(items)
    if errors:
        stats["error"] = "; ".join(errors)[:300]
    return items, stats
