# -*- coding: utf-8 -*-
"""把 Google News 連結對回「原文出處」：從不跟隨 news.google.com。

作法：抓允許的 news sitemap／RSS（各站 robots 允許），用正規化標題對上 GN 條目；
命中則改 url 為原文、帶入 image:image／enclosure／之後可再補 og:image。
快取在 repo 外（HSINCHU_GN_RESOLVE_CACHE）。
"""
from __future__ import annotations

import json
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse
from urllib import robotparser

from collectors.config import CNA_FEEDS, USER_AGENT
from collectors.httputil import make_session
from collectors.images import (
    clean_image_url,
    extract_image_url,
    feed_entry_image,
    is_generic_image,
    title_norm,
)
from collectors.news_sitemap import SOURCES as SITEMAP_SOURCES, parse_news_sitemap

TZ = timezone(timedelta(hours=8))
CACHE_VERSION = 1
GN_HOSTS = ("news.google.com",)
# 標題相似度門檻（正規化後）
RATIO_OK = 0.88
RATIO_LOOSE = 0.82  # 僅在「一方包含另一方」失敗時用
POLITE = 1.05
MAX_HTML = 262144


def cache_path() -> Path:
    return Path(os.environ.get("HSINCHU_GN_RESOLVE_CACHE")
                or "/workspace/hsinchu-watch-backups/state/gn_resolve_cache.json")


def load_cache() -> dict[str, Any]:
    p = cache_path()
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(d, dict) and d.get("version") == CACHE_VERSION:
            return d
    except Exception:
        pass
    return {"version": CACHE_VERSION, "index": {}, "resolved": {}, "fetched_at": None}


def save_cache(cache: dict[str, Any]) -> None:
    p = cache_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    # 限制 resolved 筆數
    res = cache.get("resolved") or {}
    if len(res) > 5000:
        keep = sorted(res.items(), key=lambda kv: kv[1].get("at", ""), reverse=True)[:5000]
        cache["resolved"] = dict(keep)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    os.replace(tmp, p)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


class _Robots:
    def __init__(self, sess):
        self.sess, self.parsers = sess, {}

    def allowed(self, url: str) -> bool:
        p = urlparse(url)
        host = f"{p.scheme}://{p.netloc}"
        if host not in self.parsers:
            rp = robotparser.RobotFileParser()
            try:
                r = self.sess.get(host + "/robots.txt", timeout=(5, 10))
                if r.status_code == 200:
                    rp.parse(r.text.splitlines())
                elif 400 <= r.status_code < 500:
                    rp.parse([])
                else:
                    rp.parse(["User-agent: *", "Disallow: /"])
            except Exception:
                rp.parse(["User-agent: *", "Disallow: /"])
            self.parsers[host] = rp
        rp = self.parsers[host]
        return rp.can_fetch(USER_AGENT, url) and rp.can_fetch("*", url)


def is_google_news(url: str) -> bool:
    host = (urlparse(url or "").netloc or "").lower()
    return any(host == h or host.endswith("." + h) for h in GN_HOSTS)


def outlet_from_title(title: str) -> Optional[str]:
    t = (title or "").strip()
    for sep in (" | ", "｜", " - ", " — ", " – "):
        if sep in t:
            left, right = t.rsplit(sep, 1)
            if 1 <= len(right.strip()) <= 24:
                return right.strip()
    return None


def build_index(sess, robots: _Robots, *, sleep_fn=time.sleep) -> dict[str, dict]:
    """norm_title → {url, image_url, title, source}；同標題保留有圖者優先。"""
    index: dict[str, dict] = {}

    def add(title: str, url: str, image: Optional[str], source: str):
        if not title or not url or is_google_news(url):
            return
        if urlparse(url).scheme not in ("http", "https"):
            return
        n = strong_norm(title) or title_norm(title)
        if len(n) < 8:
            return
        img = clean_image_url(image) if image else None
        if img and is_generic_image(img):
            img = None
        prev = index.get(n)
        if not prev:
            index[n] = {"url": url, "image_url": img, "title": title, "source": source, "norm": n}
            return
        # 升級：原本沒圖、現在有圖
        if not prev.get("image_url") and img:
            prev.update(url=url, image_url=img, title=title, source=source)

    # 1) news sitemaps（整份，不只姓名過濾）
    for i, (sid, sm_url, sname) in enumerate(SITEMAP_SOURCES):
        if i:
            sleep_fn(POLITE)
        if not robots.allowed(sm_url):
            continue
        try:
            r = sess.get(sm_url, timeout=(5, 25))
            if r.status_code != 200:
                continue
            rows = parse_news_sitemap(r.content[: 3 * 1024 * 1024])
            for row in rows:
                add(row.get("title") or "", row.get("loc") or "", row.get("image"), sname)
        except Exception:
            continue

    # 2) 允許的 RSS／Atom（CNA_FEEDS）
    try:
        import feedparser
    except Exception:
        feedparser = None  # type: ignore
    if feedparser is not None:
        for i, spec in enumerate(CNA_FEEDS):
            fid, furl = spec[0], spec[1]
            sname = spec[2] if len(spec) > 2 else fid
            if i:
                sleep_fn(POLITE)
            if not robots.allowed(furl):
                continue
            try:
                r = sess.get(furl, timeout=(5, 20))
                if r.status_code != 200:
                    continue
                feed = feedparser.parse(r.content)
                for e in feed.entries:
                    title = (getattr(e, "title", None) or "").strip()
                    link = getattr(e, "link", None) or ""
                    img = feed_entry_image(e)
                    add(title, link, img, sname)
            except Exception:
                continue

    # 3) 額外允許的 news sitemap／RSS（先查 robots；Disallow 則跳過）
    EXTRA = [
        ("pts_atom", "https://news.pts.org.tw/xml/newsatom.xml", "公視新聞網"),
        ("udn_breaknews", "https://udn.com/rssfeed/news/2/6638?ch=news", "聯合新聞網"),
        ("udn_local", "https://udn.com/news/rssfeed/6641", "聯合新聞網·地方"),
        ("yahoo_local", "https://tw.news.yahoo.com/rss/local", "Yahoo奇摩新聞"),
        ("yahoo_politics", "https://tw.news.yahoo.com/rss/politics", "Yahoo奇摩新聞"),
        ("storm_feed", "https://www.storm.mg/feed", "風傳媒"),
        ("tvbs_gn", "https://news.tvbs.com.tw/sitemap/news-sitemap", "TVBS新聞網"),
        ("ctwant_news", "https://static.ctwant.com/sitemaps/news.xml", "CTWANT"),
        ("ctwant_art", "https://static.ctwant.com/sitemaps/articles.xml", "CTWANT"),
        ("storm_sm", "https://www.storm.mg/sitemaps/1/sitemap.xml", "風傳媒"),
        ("setn_rss", "https://www.setn.com/news/rss", "三立新聞網"),
        ("nownews_rss", "https://www.nownews.com/rss", "NOWnews"),
        ("ltn_sitemap", "https://news.ltn.com.tw/sitemap.xml", "自由時報"),
        ("ltn_politics", "https://news.ltn.com.tw/sitemap_news_politics.xml", "自由時報"),
        ("yahoo_tw_rss", "https://tw.news.yahoo.com/rss/", "Yahoo奇摩新聞"),
    ]
    if feedparser is not None:
        for i, (fid, furl, sname) in enumerate(EXTRA):
            sleep_fn(POLITE)
            if not robots.allowed(furl):
                continue
            try:
                r = sess.get(furl, timeout=(5, 20))
                if r.status_code != 200 or not r.content:
                    continue
                # sitemap XML?
                if b"<urlset" in r.content[:2000] or b"news:news" in r.content[:4000]:
                    for row in parse_news_sitemap(r.content[: 3 * 1024 * 1024]):
                        add(row.get("title") or "", row.get("loc") or "", row.get("image"), sname)
                    continue
                feed = feedparser.parse(r.content)
                for e in feed.entries:
                    title = (getattr(e, "title", None) or "").strip()
                    link = getattr(e, "link", None) or ""
                    img = feed_entry_image(e)
                    add(title, link, img, sname)
            except Exception:
                continue

    return index



_OUTLET_SUFFIX = re.compile(
    r"(?:\|[^|\n]{1,24}|｜[^｜\n]{1,24}|-[A-Za-z0-9\u4e00-\u9fff\s]{1,24})$"
)
_PERSONS = ("吳旭智", "徐欣瑩", "鄭朝方")


def strong_norm(title: Optional[str]) -> str:
    """比 images.title_norm 更積極：連續剝 |／｜／- 後綴與空白。"""
    t = (title or "").strip()
    if not t:
        return ""
    for _ in range(4):
        for sep in (" | ", "｜", " - ", " — ", " – ", "|", "｜"):
            if sep in t:
                left, right = t.rsplit(sep, 1)
                if len(right.strip()) <= 28:
                    t = left.strip()
                    break
        else:
            break
    t = _OUTLET_SUFFIX.sub("", t).strip()
    return "".join(t.split())


def title_tokens(title: str) -> set[str]:
    """以標點／空白切詞；並強制加入出現的候選人全名與 2–4 字關鍵片段。"""
    raw = (title or "").strip()
    stop = {"新聞", "報導", "影音", "直播", "獨家", "快訊", "地方", "政治", "選戰", "九合一選舉", "選舉", "網友", "最新"}
    parts = re.split(r"[\s\|｜\-—–:：！!？?「」『』【】（）()\[\]、，,。.／/]+", raw)
    toks: set[str] = set()
    for p in parts:
        p = p.strip()
        if len(p) < 2 or p in stop:
            continue
        if len(p) <= 12:
            toks.add(p)
        else:
            # 長段再切成 2–4 字重疊片段（控制數量）
            for n in (4, 3, 2):
                for i in range(0, min(len(p) - n + 1, 24), 1):
                    frag = p[i:i + n]
                    if frag not in stop:
                        toks.add(frag)
    for name in _PERSONS:
        if name in raw:
            toks.add(name)
    # 常見關鍵人／事件詞（協助跨標題對上同一則）
    for extra in ("陳冠宇", "上官秋燕", "游毓蘭", "楊文科", "韓國瑜", "柯文哲", "競總", "竹北", "新竹縣", "開鍘", "民調"):
        if extra in raw:
            toks.add(extra)
    return {x for x in toks if len(x) >= 2}


def token_score(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = a & b
    if not inter:
        return 0.0
    if not (inter & set(_PERSONS)):
        return 0.0
    # 以較短集合為分母，避免長標題碎片把分數拉低
    base = min(len(a), len(b), 24)
    overlap = len(inter)
    return min(1.2, overlap / max(3, base * 0.35)) + 0.08 * min(5, overlap)


def best_match(norm: str, index: dict[str, dict], raw_title: str = "") -> Optional[dict]:
    """嚴格對題：只接受「幾乎同一則新聞」的標題，避免把不同報導併到少數熱門文。"""
    if not norm and not raw_title:
        return None
    sn = strong_norm(raw_title) if raw_title else norm
    keys = []
    if sn:
        keys.append(sn)
    if norm and norm != sn:
        keys.append(norm)
    for k in keys:
        if k in index:
            return index[k]
    toks = title_tokens(raw_title or sn or norm)
    persons_in = toks & set(_PERSONS)
    if not persons_in:
        # 標題沒全名 → 不配（站規歸屬本就要求全名；此處防誤配）
        return None
    # 有辨識度的詞（去掉人名與過泛地點）
    generic = set(_PERSONS) | {"竹北", "新竹縣", "新竹", "縣長", "市長", "議員", "立委", "選舉", "民調", "競總", "國民黨", "民進黨", "民眾黨"}
    distinctive = {x for x in toks if x not in generic and len(x) >= 2}
    candidates = []
    for k, v in index.items():
        vt = title_tokens(v.get("title") or k)
        if not (vt & persons_in):
            continue  # 必須同一位候選人
        base = sn or norm
        # 1) 高相似度字串
        r = SequenceMatcher(None, base, k).ratio() if base else 0.0
        # 2) 一方包含另一方（較短 ≥ 16 字）
        contain = False
        if base and k:
            shorter, longer = (base, k) if len(base) <= len(k) else (k, base)
            if len(shorter) >= 16 and shorter in longer:
                contain = True
                r = max(r, 0.92)
        # 3) 辨識詞重疊（至少 2 個非人名關鍵）
        d2 = {x for x in vt if x not in generic and len(x) >= 2}
        dist_overlap = distinctive & d2
        if contain or r >= 0.84:
            candidates.append((max(r, 0.9) + 0.02 * min(3, len(dist_overlap)), v, "strict"))
        elif len(dist_overlap) >= 2 and r >= 0.58:
            # 至少兩個辨識詞＋中等字串相近 → 視為同則不同標題
            candidates.append((0.75 + 0.05 * min(4, len(dist_overlap)) + 0.15 * r, v, "tokens"))
        elif len(dist_overlap) >= 3 and r >= 0.50:
            candidates.append((0.72 + 0.04 * len(dist_overlap) + 0.1 * r, v, "tokens"))
    if not candidates:
        return None
    candidates.sort(key=lambda x: (-x[0], -(1 if x[1].get("image_url") else 0)))
    score, top, how = candidates[0]
    if how == "strict" and score >= 0.84:
        return top
    # tokens：還要確認辨識詞確實對得上（避免只靠人名）
    if how == "tokens":
        top_dist = {x for x in title_tokens(top.get("title") or "") if x not in generic and len(x) >= 2}
        if len(distinctive & top_dist) >= 2 and score >= 0.80:
            return top
    return None

    sn = strong_norm(raw_title) if raw_title else norm
    # exact on either norm
    if sn and sn in index:
        return index[sn]
    if norm and norm in index:
        return index[norm]
    toks = title_tokens(raw_title or sn or norm)
    # 包含關係
    candidates = []
    for k, v in index.items():
        if sn and (sn in k or k in sn):
            if min(len(sn), len(k)) / max(len(sn), len(k)) >= 0.65:
                candidates.append((0.97 if sn == k else 0.93, v))
                continue
        # token overlap
        vt = title_tokens(v.get("title") or k)
        ts = token_score(toks, vt)
        if ts >= 0.30:
            candidates.append((0.5 + ts, v))
            continue
        # sequence ratio on strong norms
        base = sn or norm
        if base and abs(len(k) - len(base)) <= max(24, len(base) // 2 + 8):
            r = SequenceMatcher(None, base, k).ratio()
            share_person = bool(set(_PERSONS) & title_tokens(v.get("title") or k) & toks)
            if r >= RATIO_LOOSE or (share_person and r >= 0.55):
                candidates.append((r + (0.08 if share_person else 0), v))
    if not candidates:
        return None
    candidates.sort(key=lambda x: (-x[0], -(1 if x[1].get("image_url") else 0)))
    top_s, top_v = candidates[0]
    if top_s >= 0.65 or (top_s >= 0.38 and (title_tokens(top_v.get("title") or "") & toks & set(_PERSONS))):
        return top_v
    return None


def _fetch_og(sess, robots: _Robots, url: str) -> Optional[str]:
    if not robots.allowed(url):
        return None
    try:
        r = sess.get(url, timeout=(5, 15), stream=True)
        try:
            if r.status_code != 200:
                return None
            buf = b""
            for chunk in r.iter_content(16384):
                buf += chunk
                if len(buf) >= MAX_HTML or b"</head>" in buf[-20000:].lower():
                    break
            html = buf.decode(r.encoding or "utf-8", errors="replace")
        finally:
            r.close()
        img = extract_image_url(html, url)
        return img
    except Exception:
        return None



def enrich_index_via_search(index: dict[str, dict], sess, robots: _Robots, *, sleep_fn=time.sleep) -> int:
    """用各站允許的搜尋頁／結果，把三人相關標題補進 index（不經 Google News）。"""
    from urllib.parse import quote, urljoin, urlparse
    try:
        from bs4 import BeautifulSoup
    except Exception:
        return 0
    added = 0

    def add(title: str, url: str, source: str):
        nonlocal added
        if not title or not url or is_google_news(url):
            return
        if urlparse(url).scheme not in ("http", "https"):
            return
        # 正規化 udn vip → www
        if "vip.udn.com" in url:
            url = url.replace("vip.udn.com/vip/story/", "udn.com/news/story/")
        n = strong_norm(title) or title_norm(title)
        if len(n) < 8:
            return
        prev = index.get(n)
        if prev and prev.get("url"):
            return
        index[n] = {"url": url.split("?")[0], "image_url": None, "title": title, "source": source, "norm": n}
        added += 1

    names = ["吳旭智", "徐欣瑩", "鄭朝方"]
    # UDN search
    for name in names:
        url = "https://udn.com/search/word/2/" + quote(name)
        if not robots.allowed(url):
            continue
        sleep_fn(POLITE)
        try:
            r = sess.get(url, timeout=(5, 20))
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.select('a[href*="from=searchresult"]'):
                href = a.get("href") or ""
                title = a.get_text(" ", strip=True)
                if "/news/story/" not in href or len(title) < 10:
                    continue
                add(title, urljoin("https://udn.com", href), "聯合新聞網")
        except Exception:
            continue
    # Yahoo search HTML
    for name in names:
        url = "https://tw.news.yahoo.com/search?p=" + quote("「" + name + "」") + "&fr=sfp"
        if not robots.allowed(url):
            continue
        sleep_fn(POLITE)
        try:
            r = sess.get(url, timeout=(5, 25))
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.select("h3 a[href]"):
                href = a.get("href") or ""
                title = a.get_text(" ", strip=True)
                if "tw.news.yahoo.com" not in href or "/search" in href or len(title) < 10:
                    continue
                add(title, href.split("?")[0], "Yahoo奇摩新聞")
        except Exception:
            continue
    # TVBS search
    for name in names:
        url = f"https://news.tvbs.com.tw/news/searchresult/{quote(name)}/news"
        if not robots.allowed(url):
            continue
        sleep_fn(POLITE)
        try:
            r = sess.get(url, timeout=(5, 20))
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.select('a[href*="/politics/"], a[href*="/local/"], a[href*="/news/"]'):
                href = a.get("href") or ""
                title = a.get_text(" ", strip=True)
                if len(title) < 12:
                    continue
                add(title, urljoin("https://news.tvbs.com.tw", href), "TVBS新聞網")
        except Exception:
            continue
    return added


def resolve_items(
    items: list[dict],
    *,
    rebuild_index: bool = False,
    fetch_missing_og: bool = True,
    og_budget: int = 40,
    sess=None,
    sleep_fn=time.sleep,
) -> dict[str, Any]:
    """就地改寫 GN 條目的 url／image_url。回傳統計。"""
    cache = load_cache()
    sess = sess or make_session()
    robots = _Robots(sess)
    now = datetime.now(TZ).isoformat(timespec="seconds")

    index = cache.get("index") or {}
    fetched_at = cache.get("fetched_at")
    stale = True
    if fetched_at and index and not rebuild_index:
        try:
            stale = datetime.now(TZ) - datetime.fromisoformat(fetched_at) > timedelta(hours=6)
        except Exception:
            stale = True
    if stale or not index or rebuild_index:
        index = build_index(sess, robots, sleep_fn=sleep_fn)
        _added = enrich_index_via_search(index, sess, robots, sleep_fn=sleep_fn)
        # 序列化
        cache["index"] = index
        cache["search_added"] = _added
        cache["fetched_at"] = now
        save_cache(cache)

    resolved_map = cache.setdefault("resolved", {})
    stats = {
        "gn_total": 0,
        "replaced": 0,
        "with_image_from_index": 0,
        "with_image_from_og": 0,
        "unmatched": 0,
        "index_size": len(index),
        "og_fetched": 0,
    }
    og_used = 0

    for it in items:
        url = it.get("url") or ""
        if not is_google_news(url):
            continue
        stats["gn_total"] += 1
        # 快取命中
        prev = resolved_map.get(url)
        hit = None
        if prev and prev.get("original_url") and not is_google_news(prev["original_url"]):
            hit = {
                "url": prev["original_url"],
                "image_url": prev.get("image_url"),
                "source": prev.get("source") or "",
                "title": prev.get("title") or it.get("title"),
            }
        if not hit:
            n = title_norm(it.get("title"))
            hit = best_match(n, index, raw_title=str(it.get("title") or ""))
        if not hit:
            stats["unmatched"] += 1
            continue

        orig = hit["url"]
        img = hit.get("image_url")
        # 需要 og？
        if not img and fetch_missing_og and og_used < og_budget:
            if og_used:
                sleep_fn(POLITE)
            img = _fetch_og(sess, robots, orig)
            og_used += 1
            stats["og_fetched"] += 1
            if img:
                stats["with_image_from_og"] += 1
                hit["image_url"] = img
                hit["_from_og"] = True
                # 回寫 index
                nn = title_norm(hit.get("title") or it.get("title"))
                if nn and nn in index:
                    index[nn]["image_url"] = img

        # 改寫條目（用原文網址取代 GN；從不保留 news.google.com）
        had_img = bool(img and not is_generic_image(img))
        from_og = bool(had_img and hit.get("_from_og"))
        it["url"] = orig
        it["resolved_from"] = "google_news_title_match"
        if hit.get("source") and (not it.get("source_name") or it.get("source_name") in ("Google News", "媒體評論", "民調", "民調報導")):
            it["source_name"] = hit["source"]
        if had_img:
            it["image_url"] = img
            if from_og:
                pass  # already counted in with_image_from_og
            else:
                stats["with_image_from_index"] += 1
        stats["replaced"] += 1
        resolved_map[url] = {
            "original_url": orig,
            "image_url": it.get("image_url"),
            "source": hit.get("source"),
            "title": hit.get("title") or it.get("title"),
            "at": now,
        }

    # 去重：同一 person+新 url 可能重複
    cache["index"] = index
    cache["resolved"] = resolved_map
    cache["fetched_at"] = cache.get("fetched_at") or now
    try:
        save_cache(cache)
    except Exception:
        pass
    return stats


def resolve_gov_images(items: list[dict], *, budget: int = 30, sess=None, sleep_fn=time.sleep) -> dict[str, Any]:
    """縣府／議會／公所頁：若無圖且 robots 允許，補 og:image。"""
    GOV = ("www.hsinchu.gov.tw", "www.hcc.gov.tw", "www.zhubei.gov.tw", "hsinchu.gov.tw", "hcc.gov.tw", "zhubei.gov.tw")
    sess = sess or make_session()
    robots = _Robots(sess)
    fetched = filled = 0
    for it in items:
        if it.get("image_url"):
            continue
        host = (urlparse(it.get("url") or "").netloc or "").lower()
        if host not in GOV:
            continue
        if fetched >= budget:
            break
        url = it["url"]
        if not robots.allowed(url):
            continue
        if fetched:
            sleep_fn(POLITE)
        img = _fetch_og(sess, robots, url)
        fetched += 1
        if img:
            it["image_url"] = img
            filled += 1
    return {"gov_fetched": fetched, "gov_filled": filled}
