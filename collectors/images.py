# -*- coding: utf-8 -*-
"""文章縮圖網址（og:image 等）與「首次看到」時間戳。只存圖片「網址」，不下載圖檔。

規則（與主線一致）：
- 抓文章頁前先查該主機 robots.txt（RobotFileParser）；Disallow 就不抓、記 robots_blocked。
- 不登入、不繞付費牆；只讀前 ~256KB HTML 的 <head> meta。
- 每輪有預算（筆數＋牆鐘），先處理最新的條目；結果（含「沒有圖」）寫入增量快取，不重複抓。
- news.google.com 連結不抓（robots Disallow /，且頁內 og:image 只是 Google 通用圖示）。
- YouTube 連結直接由影片 id 組縮圖網址（i.ytimg.com），不需任何請求。
- 圖片欄位名：image_url（前端 thumb.js 已支援）；來源署名仍用該筆的 source_name。
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path
from typing import Any, Callable, Iterable, Optional
from urllib import robotparser
from urllib.parse import parse_qs, urljoin, urlparse

from collectors.config import ROOT, USER_AGENT
from collectors.httputil import make_session

TZ = timezone(timedelta(hours=8))
CACHE_VERSION = 1
MAX_HTML_BYTES = 262144
MAX_URL_LEN = 600
# 每輪預算（可用環境變數調整；0＝停用補抓，只做來源已附圖／YouTube 推導）
DEFAULT_BUDGET = int(os.environ.get("HSINCHU_IMAGE_BUDGET", "40"))
DEFAULT_DEADLINE_SEC = float(os.environ.get("HSINCHU_IMAGE_DEADLINE_SEC", "45"))
POLITE_INTERVAL_SEC = 1.05
RETRY_NONE_HOURS = 24      # 抓過但頁面沒圖：隔 24h 再試（最多 MAX_TRIES 次）
RETRY_ERROR_HOURS = 1      # 暫時錯誤：隔 1h 再試
MAX_TRIES = 3
# 不補抓正文頁的主機／平台：Google News（robots）、PTT（站內無縮圖）、政府／議會索引頁（無文章圖）
SKIP_HOSTS = ("x.com", "twitter.com", "news.google.com", "www.ptt.cc", "ptt.cc", "data.ly.gov.tw", "www.hcc.gov.tw", "www.hsinchu.gov.tw")
SKIP_PLATFORMS = ("ptt", "council", "ly")

_META_RE = re.compile(r"<meta\b[^>]*>", re.I)
_ATTR_RE = re.compile(r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
_LINK_RE = re.compile(r"<link\b[^>]*>", re.I)
_IMG_KEYS = ("og:image:secure_url", "og:image:url", "og:image", "twitter:image", "twitter:image:src")


def _now() -> datetime:
    return datetime.now(TZ)


def _attrs(tag: str) -> dict[str, str]:
    out = {}
    for m in _ATTR_RE.finditer(tag):
        out[m.group(1).lower()] = unescape(m.group(2) if m.group(2) is not None else (m.group(3) if m.group(3) is not None else m.group(4) or ""))
    return out


def clean_image_url(raw: Optional[str], base: str = "") -> Optional[str]:
    """正規化：相對→絕對；只收 http(s)；去空白；過長／data: 丟棄。"""
    if not raw:
        return None
    u = unescape(str(raw)).strip()
    if not u or u.lower().startswith(("data:", "javascript:")):
        return None
    if u.startswith("//"):
        u = "https:" + u
    if base:
        u = urljoin(base, u)
    p = urlparse(u)
    if p.scheme not in ("http", "https") or not p.netloc or len(u) > MAX_URL_LEN:
        return None
    return u


# 站台預設圖／logo（og:image 沒有文章專屬圖時的退路）：不當成文章圖，避免每張卡都放同一個 logo
GENERIC_IMAGE_RE = re.compile(r"(?:UDN_BABY|/logo|logo[-_.]|default[-_.]|placeholder|no[-_]?image|noimage|favicon|share[-_]?default|og[-_]?default)", re.I)


def is_generic_image(u: Optional[str]) -> bool:
    return bool(u and GENERIC_IMAGE_RE.search(urlparse(u).path))


def extract_image_url(html: str, base_url: str = "") -> Optional[str]:
    """從 HTML 取代表圖：og:image 系列 → twitter:image → link rel=image_src → JSON-LD image。"""
    if not html:
        return None
    head = html[:MAX_HTML_BYTES]
    found: dict[str, str] = {}
    for tag in _META_RE.findall(head):
        a = _attrs(tag)
        key = (a.get("property") or a.get("name") or "").lower()
        if key in _IMG_KEYS and a.get("content") and key not in found:
            found[key] = a["content"]
    for k in _IMG_KEYS:
        u = clean_image_url(found.get(k), base_url)
        if u and not is_generic_image(u):
            return u
    for tag in _LINK_RE.findall(head):
        a = _attrs(tag)
        if (a.get("rel") or "").lower() == "image_src":
            u = clean_image_url(a.get("href"), base_url)
            if u and not is_generic_image(u):
                return u
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', head, re.I | re.S):
        try:
            data = json.loads(m.group(1))
        except Exception:
            continue
        stack = [data]
        while stack:
            x = stack.pop()
            if isinstance(x, list):
                stack.extend(x)
            elif isinstance(x, dict):
                img = x.get("image") or x.get("thumbnailUrl")
                if isinstance(img, list) and img:
                    img = img[0]
                if isinstance(img, dict):
                    img = img.get("url")
                u = clean_image_url(img if isinstance(img, str) else None, base_url)
                if u and not is_generic_image(u):
                    return u
                stack.extend(v for v in x.values() if isinstance(v, (dict, list)))
    return None


def youtube_thumb(url: str) -> Optional[str]:
    """YouTube 影片網址 → i.ytimg.com 縮圖網址（不發請求）。"""
    try:
        p = urlparse(url or "")
        host = (p.netloc or "").lower()
        vid = None
        if host in ("youtu.be",):
            vid = p.path.strip("/").split("/")[0]
        elif host.endswith("youtube.com"):
            if p.path == "/watch":
                vid = (parse_qs(p.query).get("v") or [None])[0]
            elif p.path.startswith(("/shorts/", "/embed/", "/live/")):
                vid = p.path.split("/")[2]
        if vid and re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
            return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    except Exception:
        pass
    return None


def feed_entry_image(entry: Any) -> Optional[str]:
    """RSS/Atom entry 自帶圖（enclosure／media:content／media:thumbnail）。不存在回 None。"""
    try:
        for key in ("media_content", "media_thumbnail"):
            for m in getattr(entry, key, None) or entry.get(key, None) or []:
                u = clean_image_url((m or {}).get("url"))
                if u:
                    return u
        for enc in getattr(entry, "enclosures", None) or []:
            typ = str((enc or {}).get("type") or "").lower()
            if typ.startswith("image/") or re.search(r"\.(?:jpe?g|png|webp|gif)(?:\?|$)", str((enc or {}).get("href") or ""), re.I):
                u = clean_image_url((enc or {}).get("href"))
                if u:
                    return u
    except Exception:
        pass
    return None


# ---------------- 增量快取 ----------------
def cache_path() -> Path:
    return Path(os.environ.get("HSINCHU_IMAGE_CACHE_PATH") or "/workspace/hsinchu-watch-backups/state/image_cache.json")


def load_cache(path: Optional[Path] = None) -> dict[str, Any]:
    p = path or cache_path()
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(d, dict) and d.get("version") == CACHE_VERSION and isinstance(d.get("urls"), dict):
            return d
    except Exception:
        pass
    return {"version": CACHE_VERSION, "urls": {}}


def save_cache(cache: dict[str, Any], path: Optional[Path] = None) -> None:
    p = path or cache_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    urls = cache.get("urls", {})
    if len(urls) > 4000:  # 上限：留最近檢查的 4000 筆
        keep = sorted(urls.items(), key=lambda kv: kv[1].get("at", ""), reverse=True)[:4000]
        cache["urls"] = dict(keep)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    os.replace(tmp, p)


def _due(rec: Optional[dict], now: datetime) -> bool:
    if not rec:
        return True
    if rec.get("image_url") and not is_generic_image(rec.get("image_url")):
        return False
    st = rec.get("status")
    if st == "robots_blocked":
        return False
    tries = int(rec.get("tries") or 0)
    if tries >= MAX_TRIES:
        return False
    hours = RETRY_ERROR_HOURS if st == "error" else RETRY_NONE_HOURS
    try:
        last = datetime.fromisoformat(rec.get("at"))
        return now - last >= timedelta(hours=hours)
    except Exception:
        return True


class _Robots:
    """每主機 robots.txt 快取（本輪內）。取不到 robots（非 200）→ 依 RFC 9309：4xx 視為允許、5xx／連線失敗視為不抓。"""

    def __init__(self, sess, fetch_text: Optional[Callable[[str], tuple[int, str]]] = None):
        self.sess, self.fetch_text, self.parsers = sess, fetch_text, {}

    def allowed(self, url: str) -> bool:
        p = urlparse(url)
        host = f"{p.scheme}://{p.netloc}"
        if host not in self.parsers:
            rp = robotparser.RobotFileParser()
            try:
                if self.fetch_text:
                    code, text = self.fetch_text(host + "/robots.txt")
                else:
                    r = self.sess.get(host + "/robots.txt", timeout=(5, 10))
                    code, text = r.status_code, r.text
                if code == 200:
                    rp.parse(text.splitlines())
                elif 400 <= code < 500:
                    rp.parse([])  # 無 robots → 允許
                else:
                    rp.parse(["User-agent: *", "Disallow: /"])
            except Exception:
                rp.parse(["User-agent: *", "Disallow: /"])
            self.parsers[host] = rp
        rp = self.parsers[host]
        return rp.can_fetch(USER_AGENT, url) and rp.can_fetch("*", url)


def _fetch_html(sess, url: str) -> tuple[int, str]:
    r = sess.get(url, timeout=(5, 15), stream=True)
    try:
        code = r.status_code
        buf = b""
        for chunk in r.iter_content(chunk_size=16384):
            buf += chunk
            if len(buf) >= MAX_HTML_BYTES or b"</head>" in buf[-20000:].lower():
                break
        enc = r.encoding or "utf-8"
        return code, buf.decode(enc, errors="replace")
    finally:
        r.close()


def title_norm(title: Optional[str]) -> str:
    """標題正規化：去掉出版社後綴與空白，供同文對圖。"""
    t = (title or "").strip()
    if not t:
        return ""
    for sep in (" | ", "｜", " - ", " — ", " – "):
        if sep in t:
            # 只剝最後一段（通常是媒體名）；保留前文
            left, right = t.rsplit(sep, 1)
            if len(right) <= 20:  # 媒體名通常短
                t = left
    return "".join(t.split())


def inherit_images_by_title(items: list[dict]) -> int:
    """同文不同網址：有圖的條目把 image_url 分給標題相同、尚無圖的條目。
    特別補救 Google News／LINE TODAY 等無法抓 og:image 的連結。回傳新補上的筆數。"""
    by_title: dict[str, str] = {}
    for it in items:
        img = it.get("image_url")
        if not img or is_generic_image(img):
            continue
        n = title_norm(it.get("title"))
        if n and n not in by_title:
            by_title[n] = img
    filled = 0
    for it in items:
        if it.get("image_url") and not is_generic_image(it.get("image_url")):
            continue
        n = title_norm(it.get("title"))
        img = by_title.get(n) if n else None
        if img:
            it["image_url"] = img
            filled += 1
    return filled



def fetch_url_for_image(item: dict) -> Optional[str]:
    """優先用 resolved／canonical／image_fetch_url（非 Google News）；否則用 url。
    news.google.com 永不直接抓（robots Disallow）；若已解析出原文網址則抓原文。"""
    for key in ("image_fetch_url", "resolved_url", "canonical_url", "original_url"):
        u = item.get(key)
        if isinstance(u, str) and u.startswith(("http://", "https://")):
            host = (urlparse(u).netloc or "").lower()
            if host and host not in SKIP_HOSTS:
                return u
    u = item.get("url") or ""
    host = (urlparse(u).netloc or "").lower()
    if host in SKIP_HOSTS:
        return None
    return u if u.startswith(("http://", "https://")) else None


def eligible(item: dict) -> bool:
    u = fetch_url_for_image(item) or ""
    p = urlparse(u)
    if p.scheme not in ("http", "https"):
        return False
    if (p.netloc or "").lower() in SKIP_HOSTS:
        return False
    if item.get("platform") in SKIP_PLATFORMS:
        return False
    return True


def enrich_items(
    items: list[dict],
    *,
    cache: Optional[dict] = None,
    budget: Optional[int] = None,
    deadline_sec: Optional[float] = None,
    sess=None,
    fetch_html: Optional[Callable[[str], tuple[int, str]]] = None,
    fetch_robots: Optional[Callable[[str], tuple[int, str]]] = None,
    sleep_fn: Callable[[float], None] = time.sleep,
    save: bool = True,
) -> dict[str, Any]:
    """就地為 items 補 image_url（已有的不動）。回傳統計（穩態時數字不變，不致造成內容雜湊抖動）。"""
    budget = DEFAULT_BUDGET if budget is None else budget
    deadline_sec = DEFAULT_DEADLINE_SEC if deadline_sec is None else deadline_sec
    cache = cache if cache is not None else load_cache()
    urls = cache.setdefault("urls", {})
    now = _now()
    t0 = time.monotonic()
    fetched = errors = blocked = 0
    sess = sess or (None if fetch_html else make_session())
    robots = _Robots(sess, fetch_robots)

    # 1) 免請求：已附圖／YouTube／快取命中
    todo: list[dict] = []
    for it in items:
        if it.get("image_url") and is_generic_image(it["image_url"]):
            it.pop("image_url", None)  # 之前存進來的站台預設圖：丟掉重查
        if it.get("image_url"):
            urls.setdefault(it["url"], {"image_url": it["image_url"], "status": "feed", "at": now.isoformat(timespec="seconds")})
            continue
        yt = youtube_thumb(it.get("url") or "")
        if yt:
            it["image_url"] = yt
            continue
        rec = urls.get(it.get("url") or "")
        if rec and rec.get("image_url") and not is_generic_image(rec["image_url"]):
            it["image_url"] = rec["image_url"]
            continue
        if eligible(it) and _due(rec, now):
            todo.append(it)
    # 2) 補抓：最新的先（published_at／first_seen_at 新 → 舊）
    todo.sort(key=lambda i: i.get("published_at") or i.get("first_seen_at") or "", reverse=True)
    seen_urls: set[str] = set()
    for it in todo:
        if fetched >= budget or time.monotonic() - t0 >= deadline_sec:
            break
        url = it["url"]
        fetch_u = fetch_url_for_image(it) or url
        cache_key = url  # 快取鍵仍用條目顯示網址，避免 GN 解析後重複
        if cache_key in seen_urls:  # 同網址多人條目：只抓一次，下面統一回填
            continue
        seen_urls.add(cache_key)
        rec = dict(urls.get(cache_key) or {})
        rec["tries"] = int(rec.get("tries") or 0) + 1
        rec["at"] = now.isoformat(timespec="seconds")
        if fetch_u != url:
            rec["fetch_url"] = fetch_u
        if not robots.allowed(fetch_u):
            rec.update(status="robots_blocked", image_url=None)
            urls[cache_key] = rec
            blocked += 1
            continue
        try:
            if fetched:
                sleep_fn(POLITE_INTERVAL_SEC)
            code, html = (fetch_html or (lambda u: _fetch_html(sess, u)))(fetch_u)
            fetched += 1
            if code == 200:
                img = extract_image_url(html, fetch_u)
                rec.update(status="ok" if img else "none", image_url=img)
            else:
                rec.update(status="error", image_url=None, http=code)
                errors += 1
        except Exception as ex:  # noqa: BLE001
            fetched += 1
            errors += 1
            rec.update(status="error", image_url=None, err=str(ex)[:80])
        urls[cache_key] = rec
    for it in items:
        if not it.get("image_url"):
            rec = urls.get(it.get("url") or "")
            if rec and rec.get("image_url") and not is_generic_image(rec["image_url"]):
                it["image_url"] = rec["image_url"]
    inherited = inherit_images_by_title(items)
    if save:
        try:
            save_cache(cache)
        except Exception:  # noqa: BLE001  快取寫不進去不應擋整輪
            pass
    elig = [i for i in items if eligible(i) or youtube_thumb(i.get("url") or "")]
    return {
        "with_image": sum(1 for i in items if i.get("image_url")),
        "eligible": len(elig),
        "backlog": sum(1 for i in elig if not i.get("image_url") and _due(urls.get(i.get("url") or ""), now)),
        "fetched_this_round": fetched,
        "errors_this_round": errors,
        "robots_blocked_this_round": blocked,
        "inherited_by_title": inherited,
    }


# ---------------- 首次看到 ----------------
def stamp_first_seen(items: Iterable[dict], prev_items: Iterable[dict], now_iso: Optional[str] = None) -> int:
    """為每筆條目補 first_seen_at：沿用上一輪同 (person_id,url) 的值；全新條目＝本輪時間。
    上一輪就存在、但當時沒這欄的舊條目：維持 None（collected_at 每輪被覆寫，無法還原真正首見時間）。回傳新條目數。"""
    now_iso = now_iso or _now().isoformat(timespec="seconds")
    prev: dict[tuple, Optional[str]] = {}
    for p in prev_items:
        if isinstance(p, dict):
            prev[(p.get("person_id"), p.get("url"))] = p.get("first_seen_at")
    new = 0
    for it in items:
        k = (it.get("person_id"), it.get("url"))
        if k in prev:
            it["first_seen_at"] = it.get("first_seen_at") or prev[k]
        else:
            it["first_seen_at"] = it.get("first_seen_at") or now_iso
            new += 1
    return new
