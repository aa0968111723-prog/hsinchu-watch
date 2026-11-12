#!/usr/bin/env python3
"""Collect timely Hsinchu headlines into a separate, unreviewed news feed.

Google News RSS is a discovery feed, not evidence of the underlying claims.
No full article body or personal profiles are scraped or published.
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data/news-monitor"
DOC = ROOT / "docs/news-watch/latest.md"
LIMIT = 20
HISTORY_LIMIT = 1200
AGE_DAYS = 7

# These are independent RSS searches; do not treat RSS indexing as reporting truth.
SEARCHES = {
    "city": '"新竹市" when:7d',
    "county": '"新竹縣" when:7d',
    "councils": '(新竹市議會 OR 新竹縣議會) when:7d',
    "governance": '(新竹市政府 OR 新竹縣政府) 政策 when:7d',
    "transport": '(新竹 OR 竹北) (交通 OR 道路 OR 公車 OR 捷運) when:7d',
    "industry": '(新竹 OR 竹科) (產業 OR 科學園區 OR 就業) when:7d',
    "education": '(新竹 OR 竹北) (教育 OR 學校 OR 校園) when:7d',
    "elections": '(新竹市 OR 新竹縣) (選舉 OR 民調 OR 市長 OR 縣長) when:7d',
}
LOCALITY = ("新竹", "竹北", "竹科", "竹東", "香山", "湖口", "新豐", "新埔", "關西", "寶山", "芎林", "北埔", "峨眉", "橫山", "尖石", "五峰")
TOPICS = {
    "選舉與民調": ("選舉", "民調", "候選", "參選", "投票", "政治獻金"),
    "市政與議會": ("市府", "縣府", "議會", "議員", "質詢", "市政", "縣政", "政府", "預算", "審計"),
    "交通與建設": ("交通", "道路", "捷運", "鐵路", "公車", "工程", "施工", "通車", "橋", "停車"),
    "教育與校園": ("教育", "學校", "大學", "校園", "學生", "幼兒", "招生"),
    "經濟與科技": ("竹科", "園區", "半導體", "產業", "科技", "就業", "企業", "勞工"),
    "環境與安全": ("空污", "環保", "污染", "環境", "廢棄物", "水質", "消防", "災害", "地震"),
    "民生與公共服務": ("醫院", "醫療", "長照", "社福", "育兒", "社宅", "治安", "水電"),
}
OFFICIAL_NEEDS = {
    "選舉與民調": "核對原始民調機構、調查日期、抽樣方法及完整問卷；法定選務資訊請以選務機關為準。",
    "市政與議會": "核對政府公告、議會議事錄或預決算原文，並保留文件與基準日期。",
    "交通與建設": "核對主管機關工程進度、經費、發包、驗收及通車公告，勿以報導推估進度。",
    "教育與校園": "核對主管教育機關或校方公告，區分規劃、核定與實施。",
    "經濟與科技": "核對主管機關或企業公告，區分預測、投資承諾與已實現成果。",
    "環境與安全": "核對監測數據、主管機關公告及數據的測量基準時間。",
    "民生與公共服務": "核對主管機關公告、預算及實施範圍。",
    "地方新聞": "依原文與主管機關資訊補查事實與日期。",
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def format_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(text or "")).strip()


def safe_https(url: str) -> str:
    parsed = urllib.parse.urlsplit((url or "").strip())
    return url.strip() if parsed.scheme == "https" and parsed.netloc else ""


def feed_url(query: str) -> str:
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": query, "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"})


def parse_feed(xml_data: bytes, query_id: str, now: datetime) -> list[dict]:
    root = ET.fromstring(xml_data)
    result = []
    for item in root.findall("./channel/item"):
        title = normalize(item.findtext("title", default=""))
        link = safe_https(item.findtext("link", default=""))
        raw_date = (item.findtext("pubDate") or "").strip()
        source_el = item.find("source")
        publisher = normalize(source_el.text or "") if source_el is not None else ""
        publisher_url = safe_https(source_el.attrib.get("url", "")) if source_el is not None else ""
        if publisher and title.endswith(" - " + publisher):
            title = title[:-(len(publisher) + 3)].strip()
        if not title or not link or not raw_date or not any(x in title for x in LOCALITY):
            continue
        try:
            published = parsedate_to_datetime(raw_date)
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
            published = published.astimezone(timezone.utc)
        except (ValueError, TypeError, IndexError, OverflowError):
            continue
        if published > now + timedelta(minutes=10) or published < now - timedelta(days=AGE_DAYS):
            continue
        topic_names = [name for name, words in TOPICS.items() if any(w in title for w in words)] or ["地方新聞"]
        county = ("新竹縣" in title or any(x in title for x in ("竹北", "竹東", "湖口", "新豐", "新埔", "關西", "寶山", "芎林", "北埔", "峨眉", "橫山", "尖石", "五峰")))
        city = "新竹市" in title or "香山" in title
        region = "新竹縣" if county and not city else "新竹市" if city and not county else "新竹地區（縣市待確認）"
        identity = (publisher.casefold() + "|" + re.sub(r"\W+", "", title).casefold()) if publisher else link
        key = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]
        result.append({
            "id": key,
            "title": title,
            "url": link,
            "publisher": publisher or "來源未標示",
            "publisher_url": publisher_url or None,
            "published_at": format_utc(published),
            "publication_time_basis": "RSS 日期（未逐一核對原站）",
            "region": region,
            "topics": topic_names,
            "feed_queries": [query_id],
            "verification_status": "unreviewed",
            "review_needed": [OFFICIAL_NEEDS[t] for t in topic_names],
        })
    return result


def load_articles(path: Path) -> list[dict]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw.get("articles", []) if isinstance(raw, dict) else []
    except (OSError, json.JSONDecodeError):
        return []


def combine(fetched: list[dict], previous: list[dict], now: datetime) -> tuple[list[dict], list[dict], int]:
    items = {}
    old_ids = {a.get("id") for a in previous}
    for article in previous + fetched:
        if not article.get("id") or not article.get("published_at"):
            continue
        try:
            stamp = datetime.fromisoformat(article["published_at"].replace("Z", "+00:00"))
        except ValueError:
            continue
        if stamp.tzinfo is None or stamp < now - timedelta(days=AGE_DAYS) or stamp > now + timedelta(minutes=10):
            continue
        key = article["id"]
        if key in items:
            existing = items[key]
            existing["feed_queries"] = sorted(set(existing.get("feed_queries", [])) | set(article.get("feed_queries", [])))
        else:
            items[key] = dict(article)
    ordered = sorted(items.values(), key=lambda a: (a["published_at"], a["id"]), reverse=True)
    newly_found = len({a["id"] for a in fetched} - old_ids)
    return ordered[:LIMIT], ordered[:HISTORY_LIMIT], newly_found


def persist_json(path: Path, payload: dict) -> bool:
    content = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if path.is_file() and path.read_text(encoding="utf-8") == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")
    return True


def markdown(articles: list[dict], collected_at: str) -> str:
    lines = [
        "# 新竹地方新聞最新 20 篇（自動蒐集、尚未核實）", "",
        f"資料選取時間：{collected_at}（UTC）", "",
        "此頁只收錄標題、來源、RSS 時間及原始連結；**不代表報導已查證，也不代表政策已完成或民調支持度**。",
        "資料僅在選取內容改變時提交，排程本身每 30 分鐘檢查一次。資料不足時少於 20 篇。", "",
    ]
    for i, a in enumerate(articles, 1):
        local = datetime.fromisoformat(a["published_at"].replace("Z", "+00:00")).astimezone(ZoneInfo("Asia/Taipei"))
        safe_title = a["title"].replace("[", "\\[").replace("]", "\\]")
        lines.append(f"{i}. [{safe_title}]({a['url']}) — {a['publisher']}；{local:%Y-%m-%d %H:%M}（台灣時間）；{a['region']}；{', '.join(a['topics'])}")
    lines.extend(["", "## 核實提示", "", "若涉及工程、預算、民調、政策成效，請先比對政府原始文件與基準日期；舊版治理案卷不會由此自動覆寫。", ""])
    return "\n".join(lines)


def collect() -> int:
    now = utc_now()
    previous = load_articles(OUT / "history.json")
    fetched = []
    successes = []
    failures = []
    for query_id, query in SEARCHES.items():
        req = urllib.request.Request(feed_url(query), headers={"User-Agent": "HsinchuWatchNewsMonitor/1.0 (RSS public headline index)", "Accept": "application/rss+xml, application/xml"})
        try:
            with urllib.request.urlopen(req, timeout=12) as response:
                rss = response.read(2_000_000)
            batch = parse_feed(rss, query_id, now)
            successes.append((query_id, len(batch)))
            fetched.extend(batch)
        except (OSError, urllib.error.URLError, ET.ParseError, ValueError) as exc:
            failures.append((query_id, str(exc)[:160]))
            print(f"[WARN] RSS {query_id}: {exc}", file=sys.stderr)
    if len(successes) < 2:
        raise RuntimeError("Fewer than two news feeds succeeded; existing snapshots preserved")
    if not fetched and not previous:
        raise RuntimeError("Feeds returned no eligible articles; refusing to publish empty snapshot")
    latest, history, newly_found = combine(fetched, previous, now)
    selected_previous = load_articles(OUT / "latest.json")
    # Avoid 48 empty Git commits/day; only update when selected or history changes.
    history_changed = persist_json(OUT / "history.json", {"schema_version": 1, "articles": history})
    selection_changed = latest != selected_previous
    if selection_changed:
        stamp = format_utc(now)
        payload = {
            "schema_version": 1, "scope": ["新竹縣", "新竹市"],
            "latest_target": LIMIT, "published_within_days": AGE_DAYS,
            "collected_at": stamp, "selection_count": len(latest),
            "news_is_verified": False, "articles": latest,
        }
        persist_json(OUT / "latest.json", payload)
        DOC.parent.mkdir(parents=True, exist_ok=True)
        DOC.write_text(markdown(latest, stamp), encoding="utf-8", newline="\n")
    summary = f"成功 RSS {len(successes)}/{len(SEARCHES)}；抓取 {len(fetched)}；首次出現 {newly_found}；最新 {len(latest)}/{LIMIT}；最新清單變動 {selection_changed}；歷史變動 {history_changed}"
    print(summary)
    for name, error in failures:
        print(f"FAIL {name}: {error}")
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("## 新竹新聞自動蒐集\n\n" + summary + "\n\n")
            if failures:
                f.write("失敗來源：" + ", ".join(name for name, _ in failures) + "（已保留舊資料）\n\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(collect())
    except (RuntimeError, OSError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
