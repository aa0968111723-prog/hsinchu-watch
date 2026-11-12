# -*- coding: utf-8 -*-
"""PTT 蒐集：Hsinchu／Gossiping／HatePolitics（Atom＋搜尋＋需 over18 看板近頁）。

合規：
- 先查 https://www.ptt.cc/robots.txt；不允許則停止並回報
- Gossiping 送 over18=1（等同點「我已滿 18 歲」），不登入
- 請求間隔 ≥1 秒；八卦板每輪最多近 N 頁索引＋三人全名搜尋
- 推噓只留統計與 ≤30 字匿名摘錄；不存帳號／userid
"""
from __future__ import annotations

import re
import time
from typing import Any, Optional
from urllib.parse import quote, urljoin, urlparse
from urllib.robotparser import RobotFileParser

import feedparser
from bs4 import BeautifulSoup

from collectors.keywords import search_queries
from collectors.config import (
    PERSONS,
    PTT_BOARDS,
    PTT_FETCH_INTERVAL_SEC,
    PTT_INDEX_PAGES,
    PTT_SEARCH_MAX,
    REQUEST_TIMEOUT,
    USER_AGENT,
)
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item, match_persons, parse_rss_date, session, strip_html

PTT_ORIGIN = "https://www.ptt.cc"
# 只抓 push-tag 與 push-content；刻意不抓 push-userid
PUSH_RE = re.compile(
    r'<span class="[^"]*push-tag[^"]*">([^<]*)</span>.*?'
    r'<span class="[^"]*push-content[^"]*">:([^<]*)</span>',
    re.S,
)
# 輸出禁止落地的帳號相關鍵
FORBIDDEN_ACCOUNT_KEYS = frozenset({
    "author", "userid", "username", "account", "handle", "avatar",
    "push-userid", "push_userid", "user_id", "poster",
})
OVER18_BOARDS = frozenset({"Gossiping", "HatePolitics"})


def _anon(text: str) -> str:
    t = strip_html(text).strip()
    t = re.sub(r"^[\s:：]+", "", t)
    return t[:30]


def _sleep_gap(last_at: list[float], interval: float = PTT_FETCH_INTERVAL_SEC) -> None:
    """last_at 以單元素 list 傳遞，方便測試注入。"""
    now = time.monotonic()
    if last_at and last_at[0] > 0:
        wait = float(interval) - (now - last_at[0])
        if wait > 0:
            time.sleep(wait)
    if last_at is not None:
        last_at[0] = time.monotonic()


def fetch_ptt_robots(sess) -> tuple[str, int]:
    """回傳 (robots_text, http_status)。"""
    r = sess.get(f"{PTT_ORIGIN}/robots.txt", timeout=REQUEST_TIMEOUT)
    return (r.text if r.status_code == 200 else ""), int(r.status_code)


def make_ptt_robot_parser(robots_text: str) -> RobotFileParser:
    rp = RobotFileParser()
    rp.set_url(f"{PTT_ORIGIN}/robots.txt")
    if robots_text.strip():
        rp.parse(robots_text.splitlines())
    else:
        # 讀不到 → 保守拒絕
        rp.parse(["User-agent: *", "Disallow: /"])
    return rp


def robots_allows(rp: RobotFileParser, url: str, ua: str = USER_AGENT) -> bool:
    return bool(rp.can_fetch(ua, url))


def required_ptt_paths(boards: list[tuple[str, str]] | None = None) -> list[str]:
    boards = boards if boards is not None else list(PTT_BOARDS)
    paths = [f"{PTT_ORIGIN}/"]
    for board, atom in boards:
        paths.append(atom)
        paths.append(f"{PTT_ORIGIN}/bbs/{board}/")
        paths.append(f"{PTT_ORIGIN}/bbs/{board}/index.html")
        paths.append(f"{PTT_ORIGIN}/bbs/{board}/search?q=test")
    return paths


def check_robots_gate(sess, boards: list[tuple[str, str]] | None = None) -> dict[str, Any]:
    """查 robots；任一路徑不允許則 allowed=False。"""
    text, status = fetch_ptt_robots(sess)
    rp = make_ptt_robot_parser(text)
    blocked = []
    for url in required_ptt_paths(boards):
        if not robots_allows(rp, url):
            blocked.append(url)
    return {
        "allowed": not blocked and status == 200,
        "robots_status": status,
        "blocked": blocked,
        "robots_text_len": len(text),
        "parser": rp,
    }


def apply_over18_cookie(sess, boards: list[tuple[str, str]] | None = None) -> bool:
    """若看板需年齡確認，設定 over18=1；回傳是否有設定。"""
    boards = boards if boards is not None else list(PTT_BOARDS)
    need = any(b in OVER18_BOARDS for b, _ in boards)
    if need:
        sess.cookies.set("over18", "1", domain="www.ptt.cc", path="/")
    return need


def _polite_get(sess, url: str, last_at: list[float], rp: Optional[RobotFileParser] = None):
    if rp is not None and not robots_allows(rp, url):
        raise PermissionError(f"robots.txt disallows {url}")
    _sleep_gap(last_at)
    return sess.get(url, timeout=REQUEST_TIMEOUT)


def _push_stats(sess, url: str, last_at: list[float], rp: Optional[RobotFileParser] = None):
    try:
        r = _polite_get(sess, url, last_at, rp)
        if r.status_code != 200:
            return None
        # 年齡閘若仍跳出，視為失敗（cookie 應已處理）
        if "over18" in r.url or "請問您是否已滿 18 歲" in r.text:
            return None
        pushes = PUSH_RE.findall(r.text)
        if not pushes:
            return None
        pos = neg = neu = 0
        excerpts = []
        for tag, content in pushes[:100]:
            tag, content = tag.strip(), content.strip()
            if "推" in tag:
                pos += 1
                sent = "pos"
            elif "噓" in tag:
                neg += 1
                sent = "neg"
            else:
                neu += 1
                sent = "neu"
            if len(excerpts) < 5 and content:
                excerpts.append({"sentiment": sent, "text": _anon(content), "url": url})
        return {"push": pos, "boo": neg, "arrow": neu, "excerpts": excerpts}
    except Exception:
        return None


def _parse_list_ents(soup: BeautifulSoup) -> list[dict]:
    out = []
    for ent in soup.select("div.r-ent"):
        a = ent.select_one("div.title a")
        if not a or not a.get("href"):
            continue
        href = urljoin(PTT_ORIGIN, a["href"])
        title = a.get_text(strip=True)
        date_el = ent.select_one("div.date")
        date_s = date_el.get_text(strip=True) if date_el else ""
        out.append({"url": href, "title": title, "date": date_s})
    return out


def _from_search(sess, board: str, name: str, last_at: list[float], rp: Optional[RobotFileParser],
                 limit: int = PTT_SEARCH_MAX) -> list[dict]:
    url = f"{PTT_ORIGIN}/bbs/{board}/search?q={quote(name)}"
    r = _polite_get(sess, url, last_at, rp)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    return _parse_list_ents(soup)[:limit]


def _from_index(sess, board: str, last_at: list[float], rp: Optional[RobotFileParser],
                max_pages: int = PTT_INDEX_PAGES) -> list[dict]:
    """近 max_pages 頁索引（含首頁），沿「上頁」前進。"""
    url = f"{PTT_ORIGIN}/bbs/{board}/index.html"
    out: list[dict] = []
    seen_urls: set[str] = set()
    for _ in range(max(1, int(max_pages))):
        r = _polite_get(sess, url, last_at, rp)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "lxml")
        for row in _parse_list_ents(soup):
            if row["url"] in seen_urls:
                continue
            seen_urls.add(row["url"])
            out.append(row)
        prev = None
        for a in soup.select("div.btn-group-paging a"):
            label = a.get_text(strip=True)
            if "上頁" in label and a.get("href"):
                prev = urljoin(PTT_ORIGIN, a["href"])
                break
        if not prev or prev == url:
            break
        url = prev
    return out


def _scrub_forbidden(obj: Any) -> None:
    """就地刪除禁止鍵（防漏寫）。"""
    if isinstance(obj, dict):
        for k in list(obj.keys()):
            if k in FORBIDDEN_ACCOUNT_KEYS or str(k).lower() in FORBIDDEN_ACCOUNT_KEYS:
                del obj[k]
            else:
                _scrub_forbidden(obj[k])
    elif isinstance(obj, list):
        for x in obj:
            _scrub_forbidden(x)


def _append_item(items, comments, stats, seen, *, person, board, url, title, summary, published, push):
    key = (person["id"], url)
    if key in seen:
        return 0
    seen.add(key)
    extra: dict[str, Any] = {"board": board}
    if push:
        extra["engagement"] = {
            "push": push["push"], "boo": push["boo"], "arrow": push["arrow"],
        }
        if push["excerpts"]:
            extra["anonymous_excerpt"] = push["excerpts"][0]["text"]
            for ex in push["excerpts"]:
                comments.append({
                    "person_id": person["id"],
                    "person": person["name"],
                    "platform": "ptt",
                    "url": url,
                    "sentiment": ex["sentiment"],
                    "text": ex["text"],
                    "published_at": published,
                })
                stats["comment_samples"] += 1
    item = make_item(
        person=person, platform="ptt", source_name=f"PTT {board}",
        url=url, title=title, summary=summary, published_at=published,
        is_own_speech=False, sentiment_fn=score_sentiment, topics_fn=tag_topics, extra=extra,
    )
    _scrub_forbidden(item)
    items.append(item)
    return 1


def collect(sess=None, boards=None, fetch_push: bool = True, index_boards=None):
    """主蒐集。可注入 sess／boards 供測試。

    index_boards: 要掃近頁索引的看板；預設僅 Gossiping。
    """
    sess = sess or session()
    boards = list(boards) if boards is not None else list(PTT_BOARDS)
    if index_boards is None:
        # 近頁索引只掃八卦板（禮貌間隔下 3 板全掃會撞 120s 單源上限）；HatePolitics 走 Atom＋搜尋
        index_boards = [b for b, _ in boards if b == "Gossiping"]

    items: list[dict] = []
    comments: list[dict] = []
    stats: dict[str, Any] = {
        "ok": 0, "error": None, "raw": 0, "boards": {},
        "comment_samples": 0, "comments": [],
        "over18": False, "robots": {},
    }
    errors: list[str] = []
    seen: set = set()
    last_at = [0.0]

    # 1) robots 閘門
    gate = check_robots_gate(sess, boards)
    stats["robots"] = {
        "allowed": gate["allowed"],
        "robots_status": gate["robots_status"],
        "blocked": gate["blocked"],
    }
    if not gate["allowed"]:
        stats["error"] = "robots_disallow:" + (",".join(gate["blocked"][:5]) or f"status={gate['robots_status']}")
        stats["comments"] = comments
        return items, stats
    rp = gate["parser"]

    # 2) over18（八卦板）
    stats["over18"] = apply_over18_cookie(sess, boards)

    # 3) Atom
    for board, atom in boards:
        try:
            r = _polite_get(sess, atom, last_at, rp)
            r.raise_for_status()
            feed = feedparser.parse(r.content)
            n = 0
            for e in feed.entries:
                stats["raw"] += 1
                title = strip_html(getattr(e, "title", "") or "")
                summary = strip_html(getattr(e, "summary", "") or "")
                link = getattr(e, "link", "") or ""
                published = parse_rss_date(
                    getattr(e, "published", None) or getattr(e, "updated", None)
                )
                persons = match_persons(f"{title} {summary}", PERSONS)
                if not persons:
                    continue
                # Atom／搜尋：須標題或摘要含全名（match_persons 已要求）
                push = _push_stats(sess, link, last_at, rp) if (fetch_push and link) else None
                for person in persons:
                    n += _append_item(
                        items, comments, stats, seen,
                        person=person, board=board, url=link, title=title,
                        summary=summary, published=published, push=push,
                    )
            stats["boards"][board + "_atom"] = n
        except Exception as ex:
            errors.append(f"{board}_atom:{ex}")
            stats["boards"][board + "_atom"] = f"error:{ex}"

    # 4) HTML 搜尋（三人全名，均等）
    for board, _ in boards:
        for person in PERSONS:
            try:
                queries = search_queries(person["id"]) or [person["name"]]
                rows = []
                seen_u = set()
                for q in queries[:4]:
                    for row in _from_search(sess, board, q, last_at, rp):
                        u = row.get("url") or ""
                        if u in seen_u:
                            continue
                        seen_u.add(u)
                        rows.append(row)
                n = 0
                for row in rows:
                    if person["name"] not in row["title"]:
                        continue
                    stats["raw"] += 1
                    push = _push_stats(sess, row["url"], last_at, rp) if fetch_push else None
                    n += _append_item(
                        items, comments, stats, seen,
                        person=person, board=board, url=row["url"], title=row["title"],
                        summary=f"PTT {board} 搜尋：{person['name']}",
                        published=None, push=push,
                    )
                stats["boards"][f"{board}_search_{person['id']}"] = n
            except Exception as ex:
                errors.append(f"{board}_search_{person['id']}:{ex}")
                stats["boards"][f"{board}_search_{person['id']}"] = f"error:{ex}"

    # 5) 八卦板近頁索引（標題含全名才收）
    for board in index_boards:
        try:
            rows = _from_index(sess, board, last_at, rp, max_pages=PTT_INDEX_PAGES)
            n = 0
            for row in rows:
                persons = [p for p in PERSONS if p["name"] in row["title"]]
                if not persons:
                    continue
                stats["raw"] += 1
                push = _push_stats(sess, row["url"], last_at, rp) if fetch_push else None
                for person in persons:
                    n += _append_item(
                        items, comments, stats, seen,
                        person=person, board=board, url=row["url"], title=row["title"],
                        summary=f"PTT {board} 近頁：{person['name']}",
                        published=None, push=push,
                    )
            stats["boards"][f"{board}_index"] = n
        except Exception as ex:
            errors.append(f"{board}_index:{ex}")
            stats["boards"][f"{board}_index"] = f"error:{ex}"

    stats["ok"] = len(items)
    _scrub_forbidden(comments)
    stats["comments"] = comments
    if errors:
        stats["error"] = "; ".join(errors)[:500]
    return items, stats
