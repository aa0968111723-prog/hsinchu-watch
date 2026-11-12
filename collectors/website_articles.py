# -*- coding: utf-8 -*-
"""官網只收「文章頁」（補丁 008）。

適用三人官網（config PERSONS[].website）：鄭朝方（若有）、徐欣瑩、吳旭智。
規則：連文字／URL 拒絕表 + 外站社群網域 + 頁面須有標題、可解析日期、正文 ≥ MIN_BODY_CHARS
且非「幾乎都是連結」的列表／導覽頁。

排除原因碼（寫入 excluded，不靜默丟棄）：
- official_social_domain
- official_nav_link_text
- official_nav_or_list_url
- official_index_page
- official_missing_title
- official_missing_date
- official_body_too_short
- official_mostly_links
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Mapping, Optional, Tuple
from urllib.parse import urlparse

from bs4 import BeautifulSoup

MIN_BODY_CHARS = 80
MAX_LINK_CHAR_RATIO = 0.55

# 連文字拒絕（大小寫不敏感；中文原樣）
LINK_TEXT_DENY = (
    "加 line", "line 好友", "加入 line", "line好友",
    "看全部", "看更多", "更多報導", "全部報導", "全部推薦", "更多推薦",
    "share", "分享", "轉貼", "追蹤我們", "訂閱",
    "facebook", "instagram", "youtube", "threads",
    "上一頁", "下一頁", "previous", "next", "load more", "read more",
    "回首頁", "home", "sitemap", "網站地圖",
)

# URL path／query 拒絕片段
URL_DENY_SUBSTR = (
    "/join", "/endorse", "/towns", "/share", "/tag/", "/tags/",
    "/category/", "/categories/", "/page/", "/pages/",
    "/login", "/signup", "/register", "/cart", "/search",
    "line.me", "facebook.com", "instagram.com", "youtube.com",
    "threads.net", "fb.com", "youtu.be",
)

SOCIAL_HOST_SUFFIXES = (
    "line.me", "facebook.com", "fb.com", "instagram.com",
    "youtube.com", "youtu.be", "threads.net", "twitter.com", "x.com",
    "linkedin.com", "tiktok.com",
)

# 首頁／索引：path 為 / 或空
INDEX_PATHS = frozenset({"/", ""})

# 常見列表／地圖／總覽路徑（仍允許 /politics/xxx 文章）
LIST_PATH_RE = re.compile(
    r"(?i)/(record|towns|endorse|join|news/?$|blog/?$|posts/?$|articles/?$|list/?$|"
    r"archive|category|tag|topics?|sitemap)(/|$)"
)

DATE_ATTR_KEYS = ("datetime", "content", "data-date", "data-time")
DATE_META_NAMES = (
    "article:published_time", "article:modified_time", "pubdate",
    "publishdate", "date", "dc.date", "parsely-pub-date",
)
DATE_RE = re.compile(
    r"(?:"
    r"20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?"
    r"|"
    r"\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*20\d{2}"
    r")",
    re.I,
)


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def host_is_social(netloc: str) -> bool:
    h = (netloc or "").lower().split(":")[0]
    if h.startswith("www."):
        h = h[4:]
    return any(h == s or h.endswith("." + s) for s in SOCIAL_HOST_SUFFIXES)


def link_text_denied(text: str) -> Optional[str]:
    n = _norm(text)
    if not n:
        return "official_nav_link_text"
    for d in LINK_TEXT_DENY:
        if d in n:
            return "official_nav_link_text"
    return None


def url_denied(url: str, *, base_host: Optional[str] = None) -> Optional[str]:
    try:
        p = urlparse(url)
    except Exception:
        return "official_nav_or_list_url"
    if host_is_social(p.netloc):
        return "official_social_domain"
    if base_host:
        bh = base_host.lower().split(":")[0]
        nh = (p.netloc or "").lower().split(":")[0]
        if bh.startswith("www."):
            bh = bh[4:]
        if nh.startswith("www."):
            nh = nh[4:]
        if nh and bh and nh != bh:
            # 外站非社群：官網蒐集也不收
            return "official_social_domain"
    path = p.path or "/"
    full = (path + ("?" + p.query if p.query else "")).lower()
    if path.rstrip("/") in INDEX_PATHS or path in INDEX_PATHS:
        return "official_index_page"
    for frag in URL_DENY_SUBSTR:
        if frag in full or frag in (p.netloc or "").lower():
            if frag in ("line.me", "facebook.com", "instagram.com", "youtube.com", "threads.net", "fb.com", "youtu.be"):
                return "official_social_domain"
            return "official_nav_or_list_url"
    if LIST_PATH_RE.search(path):
        return "official_nav_or_list_url"
    # pagination query
    if re.search(r"(?:[?&]|/)(?:page|p)=\d+", full):
        return "official_nav_or_list_url"
    return None


def classify_official_link(url: str, link_text: str, *, base_host: Optional[str] = None) -> Optional[str]:
    """回傳排除 reason；None 表示可進入頁面級檢查。"""
    r = url_denied(url, base_host=base_host)
    if r:
        return r
    r = link_text_denied(link_text)
    if r:
        return r
    return None


def _extract_title(soup: BeautifulSoup) -> str:
    h1 = soup.find("h1")
    if h1:
        t = h1.get_text(" ", strip=True)
        if t:
            return t
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        return og["content"].strip()
    return ""


def _find_date_string(soup: BeautifulSoup, html: str) -> Optional[str]:
    for time_el in soup.find_all("time"):
        for k in DATE_ATTR_KEYS:
            v = time_el.get(k)
            if v and DATE_RE.search(v):
                return v.strip()
        tx = time_el.get_text(" ", strip=True)
        if tx and DATE_RE.search(tx):
            return tx
    for meta in soup.find_all("meta"):
        name = (meta.get("name") or meta.get("property") or "").lower()
        if name in DATE_META_NAMES or name.endswith("published_time"):
            v = meta.get("content") or ""
            if v:
                return v.strip()
    m = DATE_RE.search(html or "")
    return m.group(0) if m else None


def _parseable_date(s: Optional[str]) -> bool:
    if not s:
        return False
    s = s.strip()
    if not DATE_RE.search(s) and not re.match(r"20\d{2}-\d{2}-\d{2}", s):
        return False
    # try dateutil if present
    try:
        from dateutil import parser as dp
        dp.parse(s, fuzzy=True)
        return True
    except Exception:
        pass
    # fallback: regex match is enough for 2024-01-02 / 2024年1月2日
    return bool(DATE_RE.search(s) or re.match(r"20\d{2}-\d{2}-\d{2}T", s))


def _main_body(soup: BeautifulSoup) -> Tuple[str, int, int]:
    """回傳 (text, text_len, link_text_len)。"""
    root = soup.find("article") or soup.find("main") or soup.body or soup
    # remove nav/footer/script
    for tag in root.find_all(["nav", "footer", "script", "style", "noscript", "header"]):
        tag.decompose()
    texts = []
    link_len = 0
    for el in root.find_all(string=True):
        parent = getattr(el, "parent", None)
        if parent is None:
            continue
        t = str(el).strip()
        if not t:
            continue
        texts.append(t)
        if parent.name == "a":
            link_len += len(t)
    blob = "\n".join(texts)
    return blob, len(re.sub(r"\s+", "", blob)), link_len


def evaluate_article_html(html: str, url: str = "") -> Tuple[bool, Optional[str], dict]:
    """頁面級：標題、日期、正文。回傳 (ok, reason, meta)。"""
    soup = BeautifulSoup(html or "", "lxml")
    title = _extract_title(soup)
    meta: dict[str, Any] = {"title": title, "url": url}
    if len(title) < 4:
        return False, "official_missing_title", meta
    raw_date = _find_date_string(soup, html or "")
    meta["date_raw"] = raw_date
    if not _parseable_date(raw_date):
        return False, "official_missing_date", meta
    body, body_len, link_len = _main_body(soup)
    meta["body_len"] = body_len
    meta["link_text_len"] = link_len
    if body_len < MIN_BODY_CHARS:
        return False, "official_body_too_short", meta
    if body_len > 0 and (link_len / max(body_len, 1)) > MAX_LINK_CHAR_RATIO:
        return False, "official_mostly_links", meta
    return True, None, meta



def extract_body_preview(html: str, limit: int = 400) -> str:
    soup = BeautifulSoup(html or "", "lxml")
    blob, _, _ = _main_body(soup)
    return re.sub(r"\s+", " ", blob).strip()[:limit]


def classify_website_item(item: Mapping[str, Any]) -> Optional[str]:
    """對已蒐集的 website item 做連／URL 啟發式（無 HTML 時）。None=放行。"""
    if str(item.get("platform") or "") != "website":
        return None
    url = str(item.get("url") or "")
    title = str(item.get("title") or "")
    r = classify_official_link(url, title)
    if r:
        return r
    # 無日期的官網列（舊蒐集只有連結文字）→ 視為非文章
    if not item.get("published_at"):
        # 仍可能是尚未解析日期的真文章；若 summary 僅「官方網站」且無正文特徵 → 排除
        summary = str(item.get("summary") or "")
        if summary.endswith("官方網站") or summary == "" or len(summary) < 40:
            return "official_missing_date"
    return None


def excluded_record(item: Mapping[str, Any], reason: str) -> dict:
    return {
        "kind": "item",
        "id": item.get("id"),
        "person_id": item.get("person_id"),
        "person": item.get("person"),
        "platform": item.get("platform") or "website",
        "title": item.get("title"),
        "url": item.get("url"),
        "reason": reason,
        "rule": "official_site_articles_only",
        "item": dict(item),
    }
