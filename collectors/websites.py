# -*- coding: utf-8 -*-
"""三人官網蒐集：只收有標題、日期、正文的文章頁（補丁 008）。"""
from __future__ import annotations

from typing import Any, Callable, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from collectors.config import PERSONS, REQUEST_TIMEOUT
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item, session, strip_html
from collectors.httputil import normalize_timeout
from collectors.website_articles import (
    classify_official_link,
    evaluate_article_html,
    excluded_record,
    extract_body_preview,
)

FetchFn = Callable[[str], str]


_ROBOTS: dict = {}


def robots_allowed(url: str) -> bool:
    """依 robots.txt 判斷（每主機快取一次；讀不到 robots 視為不允許）。"""
    from urllib.robotparser import RobotFileParser
    from collectors.config import USER_AGENT
    u = urlparse(url)
    base = f"{u.scheme}://{u.netloc}"
    rp = _ROBOTS.get(base)
    if rp is None:
        rp = RobotFileParser()
        try:
            r = session().get(base + "/robots.txt", timeout=normalize_timeout(REQUEST_TIMEOUT))
            rp.parse(r.text.splitlines() if r.status_code == 200 else ([] if r.status_code == 404 else ["User-agent: *", "Disallow: /"]))
        except Exception:
            rp.parse(["User-agent: *", "Disallow: /"])
        _ROBOTS[base] = rp
    return rp.can_fetch(USER_AGENT, url)


def _default_fetch(url: str) -> str:
    if not robots_allowed(url):
        raise PermissionError(f"robots.txt disallows {url}")
    sess = session()
    r = sess.get(url, timeout=normalize_timeout(REQUEST_TIMEOUT))
    r.raise_for_status()
    return r.text


def collect(fetch_html: Optional[FetchFn] = None):
    """fetch_html: 可注入離線 HTML 讀取（測試用）；預設走 HTTP。"""
    fetch = fetch_html or _default_fetch
    items: list[dict] = []
    excluded_official: list[dict] = []
    stats: dict[str, Any] = {"ok": 0, "error": None, "sites": {}, "excluded_official_count": 0}
    errors = []

    for person in PERSONS:
        site = person.get("website")
        if not site:
            stats["sites"][person["id"]] = "skip:no_website"
            continue
        try:
            home_html = fetch(site)
            soup = BeautifulSoup(home_html, "lxml")
            base_host = urlparse(site).netloc
            n = 0
            seen = set()

            # 首頁本身視為 index，記入 excluded（不進主軸）
            home_stub = {
                "id": None,
                "person_id": person["id"],
                "person": person["name"],
                "platform": "website",
                "title": f"{person['name']} 官方網站",
                "url": site,
                "summary": strip_html(soup.title.string if soup.title else person["name"]),
                "published_at": None,
            }
            excluded_official.append(
                excluded_record(home_stub, "official_index_page")
            )

            for a in soup.find_all("a", href=True):
                text = strip_html(a.get_text(" ", strip=True))
                if len(text) < 6:
                    continue
                full = urljoin(site, a["href"])
                if full in seen:
                    continue
                seen.add(full)

                reason = classify_official_link(full, text, base_host=base_host)
                if reason:
                    stub = {
                        "id": None,
                        "person_id": person["id"],
                        "person": person["name"],
                        "platform": "website",
                        "title": text[:120],
                        "url": full,
                        "summary": f"{person['name']} 官方網站",
                        "published_at": None,
                    }
                    excluded_official.append(excluded_record(stub, reason))
                    continue

                # 頁面級：取回 HTML 驗文章
                try:
                    page_html = fetch(full)
                except Exception as ex:
                    stub = {
                        "id": None,
                        "person_id": person["id"],
                        "person": person["name"],
                        "platform": "website",
                        "title": text[:120],
                        "url": full,
                        "summary": f"fetch_error:{ex}",
                        "published_at": None,
                    }
                    excluded_official.append(excluded_record(stub, "official_body_too_short"))
                    continue

                ok, page_reason, meta = evaluate_article_html(page_html, full)
                if not ok:
                    stub = {
                        "id": None,
                        "person_id": person["id"],
                        "person": person["name"],
                        "platform": "website",
                        "title": (meta.get("title") or text)[:120],
                        "url": full,
                        "summary": f"{person['name']} 官方網站",
                        "published_at": None,
                    }
                    excluded_official.append(excluded_record(stub, page_reason or "official_not_article"))
                    continue

                body_preview = extract_body_preview(page_html) or text

                items.append(make_item(
                    person=person, platform="website", source_name="官方網站",
                    url=full, title=(meta.get("title") or text)[:120],
                    summary=body_preview or f"{person['name']} 官方網站",
                    published_at=meta.get("date_raw"),
                    is_own_speech=True,
                    sentiment_fn=score_sentiment, topics_fn=tag_topics,
                ))
                n += 1
                if n >= 20:
                    break

            stats["sites"][person["id"]] = n
        except Exception as ex:
            errors.append(f"{person['id']}:{ex}")
            stats["sites"][person["id"]] = f"error:{ex}"

    stats["ok"] = len(items)
    stats["excluded_official"] = excluded_official
    stats["excluded_official_count"] = len(excluded_official)
    if errors:
        stats["error"] = "; ".join(errors)
    return items, stats
