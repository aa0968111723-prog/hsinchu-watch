# -*- coding: utf-8 -*-
from __future__ import annotations
from urllib.parse import quote
import feedparser
from collectors.config import PERSONS, REQUEST_TIMEOUT
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item, parse_rss_date, session, strip_html

def collect():
    sess = session()
    items, stats = [], {"ok": 0, "error": None, "raw": 0}
    try:
        for person in PERSONS:
            q = quote(f'"{person["name"]}" (新竹 OR 竹北)')
            url = f"https://news.google.com/rss/search?q={q}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
            r = sess.get(url, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            feed = feedparser.parse(r.content)
            for e in feed.entries:
                stats["raw"] += 1
                title = strip_html(getattr(e, "title", "") or "")
                summary = strip_html(getattr(e, "summary", "") or "")
                if person["name"] not in f"{title} {summary}":
                    continue
                items.append(make_item(
                    person=person, platform="news", source_name="Google News",
                    url=getattr(e, "link", "") or "", title=title, summary=summary,
                    published_at=parse_rss_date(getattr(e, "published", None) or getattr(e, "updated", None)),
                    is_own_speech=False, sentiment_fn=score_sentiment, topics_fn=tag_topics,
                ))
        stats["ok"] = len(items)
    except Exception as ex:
        stats["error"] = str(ex)
    return items, stats
