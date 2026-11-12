# -*- coding: utf-8 -*-
"""HTML 公開新聞列表（SOURCES_008）。

- 僅抓 config.HTML_NEWS_SOURCES 中 enabled=True 者
- 政府／政黨：必須標題含追蹤全名
- 本人官網（platform=website）：persons_hint 可掛本人（own speech）；仍優先全名
- 摘要 ≤30 字；不存帳號
"""
from __future__ import annotations
import re
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
from collectors.config import HTML_NEWS_SOURCES, ID_TO_PERSON, PERSONS, REQUEST_TIMEOUT
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item, session, strip_html

DATE_RE = re.compile(r"(20\d{2}-\d{2}-\d{2})")


def _decode(content: bytes, encoding: str) -> str:
    enc = encoding or "utf-8"
    try:
        return content.decode(enc)
    except Exception:
        return content.decode("utf-8", "replace")


def _parse_list(html: str, base_url: str, link_substr: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    base = urlparse(base_url)
    out, seen = [], set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if link_substr not in href:
            continue
        title = strip_html(a.get_text(" ", strip=True))
        if len(title) < 4:
            continue
        title_clean = DATE_RE.sub("", title)
        title_clean = re.sub(r"\s*\|\|\s*", " ", title_clean)
        title_clean = strip_html(title_clean)[:200]
        if len(title_clean) < 4:
            title_clean = title[:200]
        full = urljoin(base_url, href)
        pu = urlparse(full)
        # 略過列表自身、僅錨點
        if pu.path.rstrip("/") == (base.path or "/").rstrip("/") and not pu.query:
            continue
        if full.rstrip("/") == base_url.rstrip("/"):
            continue
        if full in seen:
            continue
        seen.add(full)
        m = DATE_RE.search(title)
        published = f"{m.group(1)}T00:00:00+08:00" if m else None
        out.append({"url": full, "title": title_clean, "published_at": published, "raw_title": title})
    return out


def _persons_for_row(blob: str, spec: dict) -> list[dict]:
    hits = [p for p in PERSONS if p["name"] in blob]
    if hits:
        return hits
    # 本人官網列表：無全名時仍掛 persons_hint（own speech）
    if spec.get("platform") == "website":
        out = []
        for pid in spec.get("persons_hint") or []:
            if pid in ID_TO_PERSON:
                out.append(ID_TO_PERSON[pid])
        return out
    return []


_ROBOTS = {}


def _robots_allowed(sess, url: str) -> bool:
    """RFC 9309：robots 200 依規則；4xx／空視為允許；5xx／連線失敗不抓。"""
    from urllib.robotparser import RobotFileParser
    from collectors.config import USER_AGENT
    from urllib.parse import urlparse
    u = urlparse(url)
    base = f"{u.scheme}://{u.netloc}"
    cached = _ROBOTS.get(base)
    if cached is not None:
        return cached.can_fetch(USER_AGENT, url) and cached.can_fetch("*", url)
    rp = RobotFileParser()
    try:
        r = sess.get(base + "/robots.txt", timeout=REQUEST_TIMEOUT)
        if r.status_code == 200:
            rp.parse(r.text.splitlines())
        elif 400 <= r.status_code < 500:
            rp.parse([])  # 無明確 Disallow
        else:
            _ROBOTS[base] = rp
            rp.parse(["User-agent: *", "Disallow: /"])
            return False
    except Exception:
        rp.parse(["User-agent: *", "Disallow: /"])
        _ROBOTS[base] = rp
        return False
    _ROBOTS[base] = rp
    return rp.can_fetch(USER_AGENT, url) and rp.can_fetch("*", url)


def collect(sources=None, fetch=True, html_by_id=None):
    """collect() 線上；測試可傳 fetch=False + html_by_id={id: html}。"""
    sess = session() if fetch else None
    items, stats = [], {"ok": 0, "error": None, "sources": {}, "skipped": {}, "robots_blocked": {}}
    errors = []
    srcs = sources if sources is not None else HTML_NEWS_SOURCES
    html_by_id = html_by_id or {}

    for spec in srcs:
        sid = spec["id"]
        if not spec.get("enabled", False):
            stats["skipped"][sid] = spec.get("skip_reason") or "disabled"
            continue
        try:
            if sid in html_by_id:
                html = html_by_id[sid]
            else:
                if not _robots_allowed(sess, spec["url"]):
                    stats["robots_blocked"][sid] = spec["url"]
                    stats["skipped"][sid] = "robots_disallow"
                    continue
                r = sess.get(spec["url"], timeout=REQUEST_TIMEOUT)
                r.raise_for_status()
                html = _decode(r.content, spec.get("encoding") or "utf-8")
            rows = _parse_list(html, spec["url"], spec["link_substr"])
            n = 0
            for row in rows:
                blob = f"{row['title']} {row.get('raw_title') or ''}"
                persons = _persons_for_row(blob, spec)
                for person in persons:
                    own = (
                        spec.get("platform") == "website"
                        and person["id"] in (spec.get("persons_hint") or [])
                    ) or (
                        spec.get("platform") == "gov"
                        and person["id"] in (spec.get("persons_hint") or [])
                        and person["name"] in blob
                    )
                    items.append(make_item(
                        person=person,
                        platform=spec.get("platform") or "gov",
                        source_name=spec["source_name"],
                        url=row["url"],
                        title=row["title"],
                        summary=row["title"][:30],
                        published_at=row.get("published_at"),
                        is_own_speech=bool(own),
                        sentiment_fn=score_sentiment,
                        topics_fn=tag_topics,
                        extra={"html_source_id": sid},
                    ))
                    n += 1
            stats["sources"][sid] = {"rows": len(rows), "items": n, "robots": spec.get("robots")}
        except Exception as ex:
            errors.append(f"{sid}:{ex}")
            stats["sources"][sid] = f"error:{ex}"
    stats["ok"] = len(items)
    if errors:
        stats["error"] = "; ".join(errors)[:500]
    return items, stats
