# -*- coding: utf-8 -*-
from __future__ import annotations
import hashlib, html, re
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
import requests
from collectors.config import REQUEST_TIMEOUT, USER_AGENT
from collectors.httputil import fetch_feed, http_get, make_session, normalize_timeout

TZ_TW = timezone(timedelta(hours=8))
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")

def now_tw() -> str:
    return datetime.now(TZ_TW).isoformat()

def session() -> requests.Session:
    """回傳預設帶 (connect, read) timeout 的 Session（補丁 009）。"""
    return make_session()

def strip_html(text: str | None) -> str:
    if not text:
        return ""
    return WS_RE.sub(" ", html.unescape(TAG_RE.sub(" ", text))).strip()

def to_iso_tw(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TZ_TW).isoformat()

def parse_rss_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return to_iso_tw(parsedate_to_datetime(value))
    except Exception:
        return None

def normalize_url(url: str | None) -> str | None:
    if not url:
        return None
    url = url.strip()
    try:
        p = urlparse(url)
        if not p.scheme:
            return None
        q = parse_qs(p.query)
        for k in list(q.keys()):
            if k.lower().startswith("utm_") or k in {"fbclid", "gclid"}:
                del q[k]
        return urlunparse((p.scheme, p.netloc, p.path, "", urlencode({k: v[0] for k, v in q.items()}), ""))
    except Exception:
        return url

def item_id(url: str, person: str, platform: str) -> str:
    return hashlib.sha1(f"{person}|{platform}|{url}".encode()).hexdigest()[:16]

def match_persons(text: str, persons: list[dict]) -> list[dict]:
    """FILTER_007：須含全名；地理用新竹縣／竹北（見 config.geo_filters）。"""
    hits = []
    for p in persons:
        if p["name"] not in text and not any(a in text for a in p["aliases"]):
            continue
        geo_ok = any(g in text for g in p["geo_filters"])
        if geo_ok or p["name"] in text:
            hits.append(p)
    return hits

def _apply_sentiment(sentiment_fn, blob: str, person_name: str) -> str:
    """【柏能代理暫裁（暫定）／classifier_r1】優先傳入 person_name 做多人歸屬。"""
    try:
        return sentiment_fn(blob, person_name)
    except TypeError:
        return sentiment_fn(blob)

def make_item(*, person, platform, source_name, url, title, summary, published_at, is_own_speech, sentiment_fn, topics_fn, extra=None):
    url_n = normalize_url(url) or url
    blob = f"{title} {summary}"
    item = {
        "id": item_id(url_n, person["id"], platform),
        "person_id": person["id"],
        "person": person["name"],
        "platform": platform,
        "source_name": source_name,
        "url": url_n,
        "title": strip_html(title)[:200],
        "summary": strip_html(summary)[:400],
        "published_at": published_at,
        "collected_at": now_tw(),
        "topics": topics_fn(blob),
        "sentiment": _apply_sentiment(sentiment_fn, blob, person["name"]),
        "engagement": None,
        "is_own_speech": bool(is_own_speech),
        "anonymous_excerpt": None,
    }
    if extra:
        item.update(extra)
    return item
