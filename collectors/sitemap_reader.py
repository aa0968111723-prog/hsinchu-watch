# -*- coding: utf-8 -*-
"""官網 sitemap 讀取草稿（012）：robots → sitemap → ≥2026-01-01 → 補丁 008 文章頁 → 每人上限。

鄭朝方：本輪仍無可用官網（見 compliance_table 缺口紀錄），不臆造 URL。
"""
from __future__ import annotations

import json
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib import robotparser
from xml.etree import ElementTree as ET

import requests
from bs4 import BeautifulSoup

# 主線：套件內匯入（草稿為同目錄匯入）
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
from collectors import article_date, official_stats  # noqa: E402
from collectors import sitemap_state  # noqa: E402

# 可選：重用主線 008 規則
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
try:
    from collectors.website_articles import (  # type: ignore
        classify_official_link,
        evaluate_article_html,
        extract_body_preview,
        MIN_BODY_CHARS,
    )
    HAS_008 = True
except Exception:
    HAS_008 = False
    MIN_BODY_CHARS = 80

TZ_TW = timezone(timedelta(hours=8))
CUTOFF = datetime(2026, 1, 1, 0, 0, 0, tzinfo=TZ_TW)
MAX_PER_PERSON_PER_RUN = 30  # 三人相同；記於 DONE／APPLY（保留上限，實際抓取另受 N 限制）
MAX_FETCH_PER_PERSON = 80  # 舊上限；r7 改以 config.SITEMAP_MAX_FETCH_PER_SITE（N）為準
USER_AGENT = "HsinchuWatchBot/0.1 (+public open-data aggregator; sitemap reader draft; no secrets)"
REQUEST_TIMEOUT = 25
MIN_INTERVAL = 1.05


def _max_fetch_per_site() -> int:
    """每站每輪最多抓正文數 N（可環境變數覆寫）。"""
    import os
    raw = (os.environ.get("HSINCHU_SITEMAP_MAX_FETCH") or "").strip()
    if raw:
        try:
            n = int(raw)
            if n > 0:
                return n
        except ValueError:
            pass
    try:
        from collectors.config import SITEMAP_MAX_FETCH_PER_SITE
        return int(SITEMAP_MAX_FETCH_PER_SITE)
    except Exception:
        return 20


SITES: list[dict[str, Any]] = [
    {
        "person": "鄭朝方",
        "official_website": None,
        "source_name": "鄭朝方官方網站",
        "skip_reason": (
            "缺口：無符合條件之公開官網。"
            "已查：config.website=None；PROMPT 僅 FB/IG/Threads/YT；"
            "2022 政見頁 zhubei2022.com 現已 SSL/500 不可用；"
            "民進黨提名稿未附個人競選網域；Threads 仍列 zhubei2022.com 但站台失效。"
        ),
        "checked_sources": [
            "collectors/config.py website=None",
            "PROMPT.md 白名單（無獨立官網）",
            "https://www.nownews.com/news/5951273（zhubei2022.com 2022）",
            "https://zhubei2022.com/（本輪 SSL/500 失效）",
            "https://www.dpp.org.tw/news/contents/8596（提名無個人網域）",
            "https://www.threads.com/@new.change13（簡介列失效網域）",
        ],
    },
    {
        "person": "徐欣瑩",
        "official_website": "https://www.shesinging.tw/",
        "source_name": "徐欣瑩官方網站",
    },
    {
        "person": "吳旭智",
        "official_website": "https://www.drmorning.tw/",
        "source_name": "吳旭智官方網站",
    },
]

EXCLUDE_SEGMENTS = frozenset({
    "tag", "tags", "category", "categories", "author", "authors",
    "page", "pages", "attachment", "attachments", "feed", "feeds",
    "wp-json", "wp-admin", "wp-content", "wp-includes",
})
NAV_SINGLE = frozenset({"", "about", "join", "endorse", "towns", "contact", "event", "news", "blog", "politics", "record"})
FILE_EXT = re.compile(r"\.(?:jpe?g|png|gif|webp|svg|pdf|zip|css|js|mp4|woff2?|ico)(?:\?|$)", re.I)
NEWS_RE = re.compile(r"/news/\d{4}/\d+", re.I)

_last = 0.0


def now_tw() -> str:
    return datetime.now(TZ_TW).isoformat()


def _polite_get(sess: requests.Session, url: str) -> requests.Response:
    global _last
    wait = MIN_INTERVAL - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    r = sess.get(url, timeout=REQUEST_TIMEOUT)
    _last = time.monotonic()
    return r


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1].lower() if tag else ""


def parse_robots_sitemaps(robots_text: str) -> list[str]:
    out = []
    for line in (robots_text or "").splitlines():
        if line.lower().startswith("sitemap:"):
            u = line.split(":", 1)[1].strip()
            if u:
                out.append(u)
    return out


def make_robot_parser(base_url: str, robots_text: str) -> robotparser.RobotFileParser:
    rp = robotparser.RobotFileParser()
    rp.set_url(urljoin(base_url, "/robots.txt"))
    rp.parse((robots_text or "").splitlines())
    return rp


def is_allowed(rp: robotparser.RobotFileParser, url: str) -> bool:
    try:
        return bool(rp.can_fetch(USER_AGENT, url))
    except Exception:
        return False


def is_article_url(url: str, site_host: str) -> bool:
    try:
        p = urlparse(url)
    except Exception:
        return False
    if p.scheme not in ("http", "https"):
        return False

    def strip_www(h: str) -> str:
        h = (h or "").lower()
        return h[4:] if h.startswith("www.") else h

    if strip_www(p.netloc) != strip_www(site_host):
        return False
    path = p.path or "/"
    if FILE_EXT.search(path):
        return False
    segs = [s for s in path.split("/") if s]
    low = [s.lower() for s in segs]
    if any(s in EXCLUDE_SEGMENTS for s in low):
        return False
    if NEWS_RE.search(path):
        return True
    if len(segs) == 0:
        return False
    if len(segs) == 1 and low[0] in NAV_SINGLE:
        return False
    return len(segs) >= 2 or (len(segs) == 1 and low[0] not in NAV_SINGLE)


def parse_sitemap_xml(xml_text: str) -> tuple[list[str], list[dict[str, str]]]:
    child: list[str] = []
    entries: list[dict[str, str]] = []
    if not (xml_text or "").strip():
        return child, entries
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return child, entries
    if _local(root.tag) == "sitemapindex":
        for sm in root:
            if _local(sm.tag) != "sitemap":
                continue
            for c in sm:
                if _local(c.tag) == "loc" and c.text:
                    child.append(c.text.strip())
        return child, entries
    for url_el in root:
        if _local(url_el.tag) != "url":
            continue
        loc = lastmod = ""
        for c in url_el:
            t = _local(c.tag)
            if t == "loc" and c.text:
                loc = c.text.strip()
            elif t == "lastmod" and c.text:
                lastmod = c.text.strip()
        if loc:
            entries.append({"loc": loc, "lastmod": lastmod})
    return child, entries


def normalize_date(value: str | None) -> str | None:
    if not value:
        return None
    s = value.strip()
    try:
        if s.endswith("Z"):
            s2 = s[:-1] + "+00:00"
        else:
            s2 = s
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s2):
            return datetime.fromisoformat(s2).replace(tzinfo=TZ_TW).isoformat()
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TZ_TW)
        return dt.astimezone(TZ_TW).isoformat()
    except Exception:
        pass
    m = re.search(r"(\d{4})[./年-](\d{1,2})[./月-](\d{1,2})", s)
    if m:
        try:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=TZ_TW).isoformat()
        except ValueError:
            return None
    return None


def parse_dt(value: str | None) -> datetime | None:
    iso = normalize_date(value)
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso)
    except Exception:
        return None


def on_or_after_cutoff(value: str | None) -> bool:
    dt = parse_dt(value)
    return bool(dt and dt >= CUTOFF)


def passes_008_url(url: str, base_host: str) -> tuple[bool, str | None]:
    if HAS_008:
        reason = classify_official_link(url, "article", base_host=base_host)
        return (reason is None, reason)
    # 精簡後備（與 008 對齊的核心拒絕）
    low = url.lower()
    for frag in ("/tag/", "/category/", "/author/", "/page/", "/join", "/endorse", "/towns"):
        if frag in low:
            return False, "official_nav_or_list_url"
    if urlparse(url).path in ("/", ""):
        return False, "official_index_page"
    return True, None


def passes_008_html(html: str, url: str) -> tuple[bool, str | None, dict]:
    """008 標題／正文規則不變；日期改走加強解析序。"""
    # 先跑主線 008；若只因缺日期失敗，用加強解析補日期後重檢正文／標題
    if HAS_008:
        ok, reason, meta = evaluate_article_html(html, url)
        if ok:
            return ok, reason, meta
        if reason != "official_missing_date":
            return ok, reason, meta
        raw, src = article_date.extract_published_raw(html)
        if not normalize_date(raw):
            meta = dict(meta or {})
            meta["date_raw"] = raw
            meta["date_source"] = src
            return False, "official_missing_date", meta
        # 日期補上後，重用 008 的正文／標題結果：若先前只缺日期，title/body 已在 evaluate 中算過
        # 但 missing_date 時 body 可能未填；再跑一次本地檢查標題／正文長度
        soup = BeautifulSoup(html or "", "lxml")
        title = (meta or {}).get("title") or ""
        if len(title) < 4:
            return False, "official_missing_title", {"title": title, "date_raw": raw, "date_source": src}
        from collectors.website_articles import _main_body, MAX_LINK_CHAR_RATIO  # type: ignore
        body, body_len, link_len = _main_body(soup)
        if body_len < MIN_BODY_CHARS:
            return False, "official_body_too_short", {"title": title, "body_len": body_len, "date_raw": raw}
        if body_len > 0 and (link_len / max(body_len, 1)) > MAX_LINK_CHAR_RATIO:
            return False, "official_mostly_links", {"title": title, "body_len": body_len}
        return True, None, {"title": title, "date_raw": raw, "date_source": src, "body_len": body_len}

    soup = BeautifulSoup(html or "", "lxml")
    title = (soup.find("h1").get_text(strip=True) if soup.find("h1") else "") or (
        soup.title.string.strip() if soup.title and soup.title.string else ""
    )
    if len(title) < 4:
        return False, "official_missing_title", {"title": title}
    raw, src = article_date.extract_published_raw(html)
    if not normalize_date(raw):
        return False, "official_missing_date", {"title": title, "date_raw": raw, "date_source": src}
    text = re.sub(r"\s+", "", soup.get_text(" ", strip=True))
    if len(text) < MIN_BODY_CHARS:
        return False, "official_body_too_short", {"title": title, "body_len": len(text)}
    return True, None, {"title": title, "date_raw": raw, "date_source": src, "body_len": len(text)}


def collect_site(
    site: dict[str, Any],
    sess: requests.Session | None = None,
    *,
    state: dict[str, Any] | None = None,
    max_fetch: int | None = None,
    on_progress: Any = None,
) -> dict[str, Any]:
    """on_progress：每成功評估數頁呼叫一次（collect_all 用來中途存狀態，逾時也不全丟）。"""
    import time as _time
    _t0 = _time.monotonic()
    person = site["person"]
    base = site.get("official_website")
    n_limit = int(max_fetch if max_fetch is not None else _max_fetch_per_site())
    report: dict[str, Any] = {
        "person": person,
        "official_website": base,
        "source_name": site.get("source_name"),
        "robots_status": None,
        "sitemap_urls": [],
        "sitemap_total": 0,
        "after_2026_filter": 0,
        "pass_008": 0,
        "after_cap": 0,
        "newest_date": None,
        "articles": [],
        "error": None,
        "skip_reason": site.get("skip_reason"),
        "checked_sources": site.get("checked_sources") or [],
        "max_per_person": MAX_PER_PERSON_PER_RUN,
        "max_fetch_per_site": n_limit,
        "incremental": {
            "skipped_unchanged": 0,
            "fetched_ok": 0,
            "fetch_failed": 0,
            "deferred_over_n": 0,
            "marked_seen": 0,
            "reemitted_cached": 0,
        },
        "elapsed_sec": None,
    }
    if not base:
        report["error"] = site.get("skip_reason") or "無 official_website"
        return report

    sess = sess or requests.Session()
    sess.headers.update({"User-Agent": USER_AGENT, "Accept": "*/*"})
    host = urlparse(base).netloc
    seen = sitemap_state.seen_urls_for(state or sitemap_state.empty_state(), base)

    robots_url = urljoin(base, "/robots.txt")
    try:
        rr = _polite_get(sess, robots_url)
        report["robots_status"] = rr.status_code
        robots_text = rr.text if rr.status_code == 200 else ""
    except Exception as ex:
        report["error"] = f"robots fetch failed: {ex}"
        return report
    if report["robots_status"] != 200:
        report["error"] = f"robots.txt HTTP {report['robots_status']}"
        return report

    rp = make_robot_parser(base, robots_text)
    seeds = parse_robots_sitemaps(robots_text)
    if not seeds:
        for path in ("/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/wp-sitemap.xml"):
            cand = urljoin(base, path)
            if is_allowed(rp, cand):
                seeds.append(cand)
    if not seeds:
        report["error"] = "無 Sitemap"
        return report

    queue = list(seeds)
    seen_sm: set[str] = set()
    url_entries: list[dict[str, str]] = []
    fetched: list[str] = []
    while queue:
        sm = queue.pop(0)
        if sm in seen_sm:
            continue
        seen_sm.add(sm)
        if not is_allowed(rp, sm):
            continue
        try:
            resp = _polite_get(sess, sm)
        except Exception:
            continue
        if resp.status_code != 200:
            continue
        body = resp.text
        if "<urlset" not in body and "<sitemapindex" not in body:
            continue
        fetched.append(sm)
        children, entries = parse_sitemap_xml(body)
        url_entries.extend(entries)
        queue.extend(children)
    report["sitemap_urls"] = fetched
    if not fetched:
        report["error"] = "sitemap 不可讀"
        return report

    # sitemap 候選文章 URL
    candidates: list[dict[str, Any]] = []
    seen_u: set[str] = set()
    for ent in url_entries:
        loc = ent.get("loc") or ""
        if not loc or loc in seen_u:
            continue
        if not is_article_url(loc, host):
            continue
        if not is_allowed(rp, loc):
            continue
        ok008u, reason_u = passes_008_url(loc, host)
        if not ok008u:
            continue
        seen_u.add(loc)
        candidates.append({"url": loc, "lastmod": ent.get("lastmod") or ""})
    report["sitemap_total"] = len(candidates)

    # 依 lastmod 新→舊；無日期放後面
    def cand_key(c: dict[str, Any]):
        dt = parse_dt(c.get("lastmod"))
        return dt or datetime.min.replace(tzinfo=TZ_TW)

    candidates.sort(key=cand_key, reverse=True)

    # 預篩：lastmod 已知且 <2026 → 直接丟；未知日期需抓頁（日期規則不放寬）
    need_fetch = []
    for c in candidates:
        if c.get("lastmod") and parse_dt(c["lastmod"]):
            if on_or_after_cutoff(c["lastmod"]):
                need_fetch.append(c)
            # else drop pre-2026
        else:
            need_fetch.append(c)
    report["after_2026_filter"] = len(need_fetch)

    articles: list[dict[str, Any]] = []
    cached_articles: list[dict[str, Any]] = []
    fetched_n = 0
    after_2026_exact = 0
    pending_marks: list[tuple[str, str]] = []  # 成功抓取後才標已看過
    for c in need_fetch:
        if len(articles) >= MAX_PER_PERSON_PER_RUN:
            # 其餘未嘗試：不標已看過 → 下一輪續抓
            report["incremental"]["deferred_over_n"] += len(need_fetch) - need_fetch.index(c)
            break
        if fetched_n >= n_limit:
            report["incremental"]["deferred_over_n"] += len(need_fetch) - need_fetch.index(c)
            break
        url = c["url"]
        lastmod = c.get("lastmod") or ""
        if not sitemap_state.should_fetch(url, lastmod, seen):
            report["incremental"]["skipped_unchanged"] += 1
            cached = sitemap_state.cached_article(seen, url)
            if cached:  # 已收過的文章直接沿用（不重抓），否則第二輪起官網條目會消失
                cached_articles.append(cached)
            continue
        if not is_allowed(rp, url):
            continue
        try:
            page = _polite_get(sess, url)
        except Exception:
            report["incremental"]["fetch_failed"] += 1
            # 失敗不標已看過
            continue
        if page.status_code != 200:
            report["incremental"]["fetch_failed"] += 1
            continue
        fetched_n += 1
        html = page.text
        ok, reason, meta = passes_008_html(html, url)
        if not ok:
            # HTTP 成功且已評估 → 可標已看過，避免每輪重打廢頁；失敗抓取才不標
            pending_marks.append((url, lastmod, None))
            report["incremental"]["fetched_ok"] += 1
            continue
        # 日期：頁面 meta 優先，否則 lastmod（cutoff 不放寬）
        published = normalize_date(meta.get("date_raw")) or normalize_date(c.get("lastmod"))
        if not on_or_after_cutoff(published):
            pending_marks.append((url, lastmod, None))
            report["incremental"]["fetched_ok"] += 1
            continue
        after_2026_exact += 1
        title = (meta.get("title") or "").strip()
        summary = ""
        if HAS_008:
            try:
                summary = extract_body_preview(html, 400)
            except Exception:
                summary = title
        else:
            summary = title
        articles.append(
            official_stats.tag_official_article(
                {
                    "person": person,
                    "platform": "website",
                    "source_name": site.get("source_name") or host,
                    "url": url,
                    "title": title[:200],
                    "summary": (summary or "")[:400],
                    "published_at": published,
                    "collected_at": now_tw(),
                    "topics": [],
                    "sentiment": "neu",
                    "engagement": None,
                    "is_own_speech": True,
                    "body_len": meta.get("body_len"),
                    "date_source": meta.get("date_source"),
                }
            )
        )
        pending_marks.append((url, lastmod, articles[-1]))
        report["incremental"]["fetched_ok"] += 1
        # 每 5 頁就把已評估的標進狀態並存檔（中途逾時也保留進度）
        if state is not None and len(pending_marks) % 5 == 0:
            _flush_marks(state, base, pending_marks, report)
            if on_progress:
                try:
                    on_progress()
                except Exception as ex:  # noqa: BLE001
                    print(f"[sitemap] WARN progress save failed: {ex}", flush=True)

    # 只把「本輪成功抓取／評估」的 URL 標已看過；deferred／failed 不標
    if state is not None:
        _flush_marks(state, base, pending_marks, report)

    report["incremental"]["reemitted_cached"] = len(cached_articles)
    new_urls = {a["url"] for a in articles}
    merged = articles + [a for a in cached_articles if a.get("url") not in new_urls]
    merged.sort(key=lambda a: str(a.get("published_at") or ""), reverse=True)
    report["new_articles"] = len(articles)
    articles = merged
    report["pass_008"] = len(articles)
    capped = articles[:MAX_PER_PERSON_PER_RUN]
    report["after_cap"] = len(capped)
    report["articles"] = capped
    report["after_2026_filter"] = max(report["after_2026_filter"], after_2026_exact)
    report["after_2026_candidates"] = len(need_fetch)
    report["pass_008"] = len(articles)
    report["after_cap"] = len(capped)
    dates = [a["published_at"] for a in capped if a.get("published_at")]
    report["newest_date"] = max(dates) if dates else None
    report["fetched_pages"] = fetched_n
    report["elapsed_sec"] = round(_time.monotonic() - _t0, 1)
    return report


def _flush_marks(state, base, pending_marks, report) -> None:
    for u, lm, art in pending_marks:
        sitemap_state.mark_seen(state, base, u, lm, article=art)
    report["incremental"]["marked_seen"] += len(pending_marks)
    pending_marks.clear()


def collect_all(sites: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    sites = sites or SITES
    sess = requests.Session()
    sess.headers.update({"User-Agent": USER_AGENT})
    # 狀態：壞掉／不存在 → load_state 回空 → 完整抓取（仍受 N）
    state = sitemap_state.load_state()
    n_limit = _max_fetch_per_site()
    reports = []
    all_articles = []
    def _save(tag: str) -> None:
        try:
            sitemap_state.save_state(state)
        except Exception as ex:
            # 寫狀態失敗不擋本輪文章結果
            print(f"[sitemap] WARN state save failed ({tag}): {ex}", flush=True)

    for site in sites:
        rep = collect_site(site, sess=sess, state=state, max_fetch=n_limit,
                           on_progress=lambda: _save("progress"))
        slim = {k: v for k, v in rep.items() if k != "articles"}
        reports.append(slim)
        all_articles.extend(rep.get("articles") or [])
        _save("site")  # 每站結束就存：整源 120s 逾時也不會讓下一輪從零開始
        inc = rep.get("incremental") or {}
        print(f"[sitemap] site={rep.get('official_website')} elapsed={rep.get('elapsed_sec')}s "
              f"fetched={rep.get('fetched_pages')} new={rep.get('new_articles', 0)} cached={inc.get('reemitted_cached', 0)} "
              f"deferred={inc.get('deferred_over_n', 0)} state_saved", flush=True)
    return {
        "generated_at": now_tw(),
        "max_per_person_per_run": MAX_PER_PERSON_PER_RUN,
        "max_fetch_per_site": n_limit,
        "cutoff": CUTOFF.isoformat(),
        "patch_008": HAS_008,
        "sites": reports,
        "articles": all_articles,
        "counts": {r["person"]: r.get("after_cap", 0) for r in reports},
        "state_path": str(sitemap_state.state_path()),
    }



def main() -> None:
    out_dir = Path(__file__).resolve().parent / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    result = collect_all()
    gaps = official_stats.build_official_site_gaps(result.get("sites") or [])
    vol = official_stats.sentiment_volume_counts(result.get("articles") or [])
    result["official_site_gaps"] = gaps
    result["stats_excluding_official"] = vol
    path = out_dir / "sitemap_articles.json"
    if path.exists():
        bak = path.with_suffix(path.suffix + ".bak.20261110-0147")
        if not bak.exists():
            bak.write_bytes(path.read_bytes())
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    gaps_path = out_dir / "stats_official_sites.json"
    gaps_path.write_text(
        json.dumps(
            {
                "generated_at": result.get("generated_at"),
                "gaps": gaps,
                "stats_excluding_official": vol,
                "note": "官網本人發言 counts_in_stats=false，不計入聲量／情緒",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "counts": result["counts"],
        "sites": result["sites"],
        "gaps": gaps,
        "stats_excluding_official": vol,
        "max_per_person_per_run": MAX_PER_PERSON_PER_RUN,
        "path": str(path),
        "gaps_path": str(gaps_path),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
