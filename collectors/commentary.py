# -*- coding: utf-8 -*-
"""媒體評論／社論／政論文字報導，type=commentary。"""
from __future__ import annotations
from urllib.parse import quote
import feedparser
from collectors.config import PERSONS, REQUEST_TIMEOUT
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item, match_persons, parse_rss_date, session, strip_html

QUERIES = [
    '鄭朝方 (社論 OR 評論 OR 專欄 OR 政論)',
    '徐欣瑩 (社論 OR 評論 OR 專欄 OR 政論)',
    '吳旭智 (社論 OR 評論 OR 專欄 OR 政論)',
    '新竹縣長 (社論 OR 評論 OR 政論)',
]

COMMENT_HINTS = ["社論", "評論", "專欄", "政論", "觀點", "時評", "投書"]

def collect():
    sess = session()
    items, stats = [], {"ok": 0, "error": None, "raw": 0}
    seen = set()
    try:
        for q in QUERIES:
            url = f"https://news.google.com/rss/search?q={quote(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
            r = sess.get(url, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            feed = feedparser.parse(r.content)
            for e in feed.entries:
                stats["raw"] += 1
                title = strip_html(getattr(e, "title", "") or "")
                summary = strip_html(getattr(e, "summary", "") or "")
                link = getattr(e, "link", "") or ""
                if not link or link in seen:
                    continue
                blob = f"{title} {summary}"
                if not any(h in blob for h in COMMENT_HINTS):
                    # 查詢已含評論詞，仍收
                    pass
                persons = match_persons(blob, PERSONS)
                if not persons:
                    continue
                seen.add(link)
                published = parse_rss_date(getattr(e, "published", None) or getattr(e, "updated", None))
                for person in persons:
                    items.append(make_item(
                        person=person, platform="commentary", source_name="媒體評論",
                        url=link, title=title, summary=summary,
                        published_at=published, is_own_speech=False,
                        sentiment_fn=score_sentiment, topics_fn=tag_topics,
                        extra={"type": "commentary"},
                    ))
        stats["ok"] = len(items)
    except Exception as ex:
        stats["error"] = str(ex)
    return items, stats
