# -*- coding: utf-8 -*-
"""新竹縣議會／質詢頁（吳旭智）。"""
from __future__ import annotations
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
from collectors.config import ID_TO_PERSON, REQUEST_TIMEOUT
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item, session, strip_html

URLS = [
    ("議員頁", "https://www.hcc.gov.tw/member-detail?C=360&S=22&program=190"),
    ("議事錄", "https://www.hcc.gov.tw/ask?lang=&program=202"),
    ("質詢辦理", "https://www.hsinchu.gov.tw/News.aspx?n=3175&sms=10134"),
]

def collect():
    sess = session()
    person = ID_TO_PERSON["wu"]
    items, stats = [], {"ok": 0, "error": None, "pages": {}}
    errors = []
    for label, url in URLS:
        try:
            r = sess.get(url, timeout=REQUEST_TIMEOUT)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "lxml")
            n = 0
            # 本頁
            title = strip_html(soup.title.string if soup.title else label)
            items.append(make_item(
                person=person, platform="council", source_name=f"新竹縣議會／縣府·{label}",
                url=url, title=f"吳旭智｜{title}"[:120],
                summary="議會／質詢公開頁", published_at=None, is_own_speech=True,
                sentiment_fn=score_sentiment, topics_fn=tag_topics,
            ))
            n += 1
            host = urlparse(url).netloc
            for a in soup.find_all("a", href=True):
                text = strip_html(a.get_text(" ", strip=True))
                if "吳旭智" not in text and "質詢" not in text and "議事" not in text:
                    continue
                full = urljoin(url, a["href"])
                if urlparse(full).netloc != host:
                    continue
                if len(text) < 4:
                    continue
                items.append(make_item(
                    person=person, platform="council", source_name=f"新竹縣議會／縣府·{label}",
                    url=full, title=text[:120], summary="議會相關連結",
                    published_at=None, is_own_speech=True,
                    sentiment_fn=score_sentiment, topics_fn=tag_topics,
                ))
                n += 1
                if n >= 25:
                    break
            stats["pages"][label] = n
        except Exception as ex:
            errors.append(f"{label}:{ex}")
            stats["pages"][label] = f"error:{ex}"
    stats["ok"] = len(items)
    if errors:
        stats["error"] = "; ".join(errors)
    return items, stats
