# -*- coding: utf-8 -*-
"""民調：只收媒體／機構公布結果，不自做民調。"""
from __future__ import annotations
import re
from urllib.parse import quote
import feedparser
from collectors.config import PERSONS, REQUEST_TIMEOUT
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item, parse_rss_date, session, strip_html

QUERIES = [
    "新竹縣長 民調",
    "竹北市長 民調",
    "新竹縣 民調 鄭朝方",
    "新竹縣 民調 徐欣瑩",
    "竹北 民調 吳旭智",
]

ORG_HINTS = ["美麗島", "趨勢", "旺旺中時", "TVBS", "鏡新聞", "ETtoday", "聯合報", "民意調查", "民調", "世新", "艾普羅", "公信力"]

def _guess_org(text: str) -> str:
    for o in ORG_HINTS:
        if o in text:
            return o
    return "未標示機構"

def _match_person_ids(text: str) -> list[str]:
    ids = []
    for p in PERSONS:
        if p["name"] in text:
            ids.append(p["id"])
    return ids

def collect():
    sess = session()
    items, polls = [], []
    stats = {"ok": 0, "error": None, "raw": 0, "poll_records": 0}
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
                if "民調" not in blob and "支持度" not in blob:
                    continue
                seen.add(link)
                published = parse_rss_date(getattr(e, "published", None) or getattr(e, "updated", None))
                org = _guess_org(blob)
                # FILTER_007／協調暫定④：禁止 or ["zheng","xu"]；無姓名不寫 items
                pids = _match_person_ids(blob)
                if not isinstance(pids, list):
                    pids = []

                # 粗抓百分比
                percents = re.findall(r"(\d{1,2}(?:\.\d+)?)\s*%", blob)
                record = {
                    "url": link,
                    "title": title,
                    "org": org,
                    "period": None,
                    "sample_size": None,
                    "moe": None,
                    "published_at": published,
                    "support": {},
                    "raw_percents": percents[:8],
                    "person_ids": pids,
                    "race": "竹北市長" if "竹北市長" in blob else "新竹縣長",
                    "note": "數字為新聞摘錄粗解析，請以原文為準",
                }
                # 嘗試對應姓名後的百分比
                for p in PERSONS:
                    m = re.search(rf"{p['name']}[^%]{{0,12}}(\d{{1,2}}(?:\.\d+)?)\s*%", blob)
                    if m:
                        record["support"][p["id"]] = float(m.group(1))
                polls.append(record)
                for pid in pids:
                    person = next(x for x in PERSONS if x["id"] == pid)
                    items.append(make_item(
                        person=person, platform="poll", source_name=f"民調·{org}",
                        url=link, title=title, summary=summary[:300],
                        published_at=published, is_own_speech=False,
                        sentiment_fn=score_sentiment, topics_fn=tag_topics,
                        extra={"type": "poll", "poll": {
                            "org": org, "race": record["race"],
                            "support": record["support"], "raw_percents": percents[:8],
                        }},
                    ))
        stats["ok"] = len(items)
        stats["poll_records"] = len(polls)
        stats["polls"] = polls
    except Exception as ex:
        stats["error"] = str(ex)
        stats["polls"] = polls
    return items, stats
