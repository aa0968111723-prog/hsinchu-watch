# -*- coding: utf-8 -*-
"""社群平台（YouTube／Facebook／Instagram／Threads）— 只做 robots.txt 與公開條款允許的路徑。

實況（2026-11-10 查證，見 PLATFORM_STATUS）：
- facebook.com／instagram.com／threads.com／threads.net：robots.txt 對 `*` 為 Disallow: /，且全站聲明
  「未經書面許可禁止自動化蒐集」→ 一律不請求（連 oEmbed／og 預覽也不抓）。只在官方帳號「連結卡」與
  「候選人官網自己貼出的貼文連結」中出現這些網址（網址來自官網頁面，不是向 Meta 請求）。
- YouTube：/feeds/videos.xml、/results 在 robots.txt Disallow → 不用頻道 RSS、不用站內搜尋。
  允許且屬公開文件化端點的有 /oembed（單支影片資訊＋縮圖）。官方 Data API 需使用者自建免費金鑰
  （YOUTUBE_API_KEY，環境變數；沒有就不呼叫）。
- 搜尋引擎：Google／Bing 網頁搜尋 robots Disallow；Bing News RSS 版權聲明禁止此類使用；
  DuckDuckGo html 對機器回 202 驗證頁（不繞過）→ 不採用。

不存留言者帳號；候選人官方頻道與媒體名稱可顯示。圖片只存網址（image_url），不下載。
"""
from __future__ import annotations

import json
import os
import re
import time
from html import unescape
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from urllib import robotparser
from urllib.parse import parse_qs, unquote, urljoin, urlparse

from collectors.config import PERSONS, ROOT, USER_AGENT
from collectors.httputil import make_session

POLITE_INTERVAL_SEC = 1.05
OEMBED_MAX_PER_ROUND = 12
PAGE_MAX_BYTES = 600_000

PLATFORM_STATUS = {
    "facebook": {"allowed": False, "why": "robots.txt `User-agent: *` → Disallow: /；Meta 自動化蒐集條款需書面許可"},
    "instagram": {"allowed": False, "why": "robots.txt `*` → Disallow: /；同上（含 /api/v1/oembed 亦在 Disallow 內）"},
    "threads": {"allowed": False, "why": "threads.com／threads.net robots.txt `*` → Disallow: /；同上"},
    "youtube": {"allowed": "partial",
                "why": "channel RSS（/feeds/videos.xml）與站內搜尋（/results）Disallow；/oembed 允許；Data API 需金鑰"},
}

# 官方帳號（網址只作連結卡，不請求 Meta）。basis：official_site＝候選人官網自己列出；
# platform_cross_link＝帳號之間互相連結；directory＝第三方名錄／搜尋結果（較低可信，待本人確認）
OFFICIAL_CHANNELS: Dict[str, Dict[str, Dict[str, str]]] = {
    "wu": {
        "facebook": {"url": "https://www.facebook.com/Morning.MKT", "label": "晨光（吳旭智）臉書粉專",
                      "basis": "official_site",
                      "evidence": "https://www.drmorning.tw/；https://www.hcc.gov.tw/member-detail-lightbox?C=360&S=21&program=190"},
    },
    "xu": {
        "facebook": {"url": "https://www.facebook.com/shesinging.tw", "label": "徐欣瑩臉書", "basis": "official_site",
                      "evidence": "https://www.shesinging.tw/"},
        "instagram": {"url": "https://www.instagram.com/shesingingtw/", "label": "徐欣瑩 Instagram",
                       "basis": "official_site", "evidence": "https://www.shesinging.tw/"},
        "threads": {"url": "https://www.threads.com/@shesingingtw", "label": "徐欣瑩 Threads",
                     "basis": "platform_cross_link", "evidence": "Instagram 個人檔案列出同名 Threads（搜尋結果摘要）"},
        "youtube": {"url": "https://www.youtube.com/@shesingingmv", "label": "徐欣瑩 YouTube", "basis": "official_site",
                     "evidence": "https://www.shesinging.tw/", "handle": "@shesingingmv"},
    },
    "zheng": {
        "facebook": {"url": "https://www.facebook.com/newchange13", "label": "鄭朝方臉書", "basis": "platform_cross_link",
                      "evidence": "臉書粉專 About 列出 instagram.com/new.change13；Threads 簡介列 zhubei2022.com"},
        "instagram": {"url": "https://www.instagram.com/new.change13", "label": "鄭朝方 Instagram",
                       "basis": "platform_cross_link", "evidence": "臉書粉專 About「Other links」"},
        "threads": {"url": "https://www.threads.com/@new.change13", "label": "鄭朝方 Threads",
                     "basis": "directory", "evidence": "https://tshng-a.kunlim.cc/candidate/cheng-chao-fang/（第三方名錄）"},
        "youtube": {"url": "https://www.youtube.com/@%E9%84%AD%E6%9C%9D%E6%96%B9-q2t", "label": "鄭朝方 YouTube",
                     "basis": "directory", "evidence": "https://tshng-a.kunlim.cc/candidate/cheng-chao-fang/（第三方名錄）；維基百科外部連結 channel/UCzjXmEb66RBs42wX4BC3wMA（待 Data API 複驗）",
                     "handle": "@鄭朝方-q2t"},
    },
}

# 候選人官網（用來發現官網自己貼出的 YouTube 影片／社群貼文連結）
OFFICIAL_PAGES: List[Tuple[str, str]] = [
    ("xu", "https://www.shesinging.tw/"),
    ("wu", "https://www.drmorning.tw/"),
    ("wu", "https://www.drmorning.tw/category/news/"),
]


def public_channels() -> Dict[str, Dict[str, Dict[str, str]]]:
    """給 official.json 的官方帳號連結（不含 evidence 內部欄位以外的敏感資料）。"""
    out: Dict[str, Dict[str, Dict[str, str]]] = {}
    for pid, chans in OFFICIAL_CHANNELS.items():
        out[pid] = {k: {"url": v["url"], "label": v["label"], "basis": v["basis"], "evidence": v["evidence"]}
                    for k, v in chans.items()}
    return out


# ---------------------------------------------------------------- robots
class RobotsGate:
    def __init__(self, session):
        self.session = session
        self._rp: Dict[str, Optional[robotparser.RobotFileParser]] = {}

    def allowed(self, url: str) -> bool:
        p = urlparse(url)
        host = f"{p.scheme}://{p.netloc}"
        if host not in self._rp:
            rp = robotparser.RobotFileParser()
            try:
                r = self.session.get(host + "/robots.txt", timeout=(5, 15))
                if r.status_code == 200:
                    rp.parse(r.text.splitlines())
                elif r.status_code in (401, 403):
                    rp.disallow_all = True
                else:
                    rp.allow_all = True
                self._rp[host] = rp
            except Exception:  # noqa: BLE001  取不到 robots → 保守不抓
                self._rp[host] = None
        rp = self._rp[host]
        return bool(rp and rp.can_fetch(USER_AGENT, url))


# ---------------------------------------------------------------- 連結擷取
_YT_RE = re.compile(
    r"(?:https?:)?//(?:www\.|m\.)?(?:youtu\.be/|youtube\.com/(?:watch\?(?:[^\"'#<> ]*&)?v=|embed/|shorts/|live/))"
    r"([A-Za-z0-9_-]{11})", re.I)
_A_RE = re.compile(r"<a\b([^>]*)>(.*?)</a>", re.I | re.S)
_ATTR_RE = re.compile(r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')""")
_META_POST_RE = re.compile(
    r"^https?://(?:www\.|m\.)?(?:facebook\.com/[^/?#]+/(?:posts|videos|reel)/[^?#]+|facebook\.com/(?:reel|watch)/[^?#]+"
    r"|instagram\.com/(?:p|reel|tv)/[^/?#]+|threads\.(?:com|net)/@[^/?#]+/post/[^/?#]+)", re.I)


def extract_youtube_ids(html: str) -> List[str]:
    seen, out = set(), []
    for m in _YT_RE.finditer(html or ""):
        v = m.group(1)
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


def _strip_tags(s: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def extract_meta_post_links(html: str, base: str = "") -> List[Dict[str, str]]:
    """官網頁面裡指向 FB／IG／Threads「單篇貼文」的連結＋官網自己寫的說明（title 屬性或錨文字）。"""
    out, seen = [], set()
    for m in _A_RE.finditer(html or ""):
        attrs = {}
        for am in _ATTR_RE.finditer(m.group(1)):
            attrs[am.group(1).lower()] = unescape(am.group(2) if am.group(2) is not None else am.group(3))
        href = urljoin(base, attrs.get("href", "")) if base else attrs.get("href", "")
        if not _META_POST_RE.match(href) or href in seen:
            continue
        label = (attrs.get("title") or "").strip() or _strip_tags(m.group(2))
        label = re.sub(r"^出處[:：]\s*", "", label)[:120]
        if not label:
            continue
        seen.add(href)
        out.append({"url": href, "label": label})
    return out


# ---------------------------------------------------------------- 快取（repo 外）
def _state_path() -> Path:
    p = os.environ.get("HSINCHU_SOCIAL_STATE_PATH")
    return Path(p) if p else Path("/workspace/hsinchu-watch-backups/state/social_state.json")


def load_state(path: Optional[Path] = None) -> Dict[str, Any]:
    path = path or _state_path()
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(d, dict):
            return d
    except Exception:  # noqa: BLE001
        pass
    return {"oembed": {}, "uploads": {}}


def save_state(state: Dict[str, Any], path: Optional[Path] = None) -> None:
    path = path or _state_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)
    except Exception:  # noqa: BLE001  快取寫不進不影響本輪
        pass


# ---------------------------------------------------------------- YouTube
def _norm_author(url: str) -> str:
    return unquote(str(url or "")).lower().rstrip("/")


def official_youtube_author(pid: str) -> Optional[str]:
    y = (OFFICIAL_CHANNELS.get(pid) or {}).get("youtube")
    return _norm_author(y["url"]) if y else None


def thumb_for(video_id: str) -> str:
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def fetch_oembed(session, video_id: str) -> Optional[Dict[str, Any]]:
    r = session.get("https://www.youtube.com/oembed",
                    params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
                    timeout=(5, 15))
    if r.status_code != 200:
        return {"_error": r.status_code}
    d = r.json()
    return {"title": d.get("title"), "author_name": d.get("author_name"), "author_url": d.get("author_url"),
            "thumbnail_url": d.get("thumbnail_url") or thumb_for(video_id)}


def build_video_item(person: dict, video_id: str, title: str, channel_label: str, *, published_at=None,
                     thumbnail=None, discovered_via: str, make_item, sentiment_fn, topics_fn):
    url = f"https://www.youtube.com/watch?v={video_id}"
    return make_item(
        person=person, platform="youtube", source_name=f"YouTube｜{channel_label}（官方頻道）", url=url,
        title=title, summary=f"{person['name']}官方 YouTube 頻道影片（{discovered_via}）",
        published_at=published_at, is_own_speech=True, sentiment_fn=sentiment_fn, topics_fn=topics_fn,
        extra={"type": "youtube", "video_id": video_id, "image_url": thumbnail or thumb_for(video_id),
               "source_type": "official_social", "display_label": "本人發言（官方頻道）",
               "counts_in_stats": False, "date_source": "api" if published_at else "unknown",
               "discovered_via": discovered_via})


def _to_tw(v):
    from datetime import datetime, timedelta, timezone
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone(timedelta(hours=8))).isoformat()
    except Exception:  # noqa: BLE001
        return None


def api_uploads(session, key: str, handle: str, state: Dict[str, Any], limit: int = 15) -> List[Dict[str, Any]]:
    """YouTube Data API：channels.list(forHandle)→uploads 播放清單→playlistItems（各 1 單位配額）。"""
    up = (state.setdefault("uploads", {})).get(handle)
    if not up:
        r = session.get("https://www.googleapis.com/youtube/v3/channels",
                        params={"part": "contentDetails", "forHandle": handle, "key": key}, timeout=(5, 20))
        if r.status_code != 200:
            raise RuntimeError(f"channels.list HTTP {r.status_code}")
        its = r.json().get("items") or []
        if not its:
            return []
        up = its[0]["contentDetails"]["relatedPlaylists"]["uploads"]
        state["uploads"][handle] = up
    r = session.get("https://www.googleapis.com/youtube/v3/playlistItems",
                    params={"part": "snippet,contentDetails", "playlistId": up, "maxResults": limit, "key": key},
                    timeout=(5, 20))
    if r.status_code != 200:
        raise RuntimeError(f"playlistItems HTTP {r.status_code}")
    out = []
    for it in r.json().get("items") or []:
        sn, cd = it.get("snippet") or {}, it.get("contentDetails") or {}
        vid = cd.get("videoId") or (sn.get("resourceId") or {}).get("videoId")
        if not vid:
            continue
        th = sn.get("thumbnails") or {}
        thumb = (th.get("high") or th.get("medium") or th.get("default") or {}).get("url")
        out.append({"video_id": vid, "title": sn.get("title") or "", "published_at": _to_tw(cd.get("videoPublishedAt") or sn.get("publishedAt")),
                    "thumbnail": thumb, "channel": sn.get("channelTitle")})
    return out


def collect_all(*, make_item, sentiment_fn, topics_fn, session=None, state=None, pages=None, env=None):
    """回傳 (items, stats)。stats 含各平台 allowed/blocked 與每人筆數、最新時間。"""
    env = os.environ if env is None else env
    session = session or make_session()
    state = load_state() if state is None else state
    gate = RobotsGate(session)
    by_id = {p["id"]: p for p in PERSONS}
    items: List[dict] = []
    stats: Dict[str, Any] = {"ok": 0, "error": None, "platforms": PLATFORM_STATUS, "per_person": {},
                             "oembed_fetched": 0, "api": False, "meta_post_links": 0, "pages_checked": 0}
    seen_vids: set = set()
    cache = state.setdefault("oembed", {})

    # 1) Data API（有金鑰才用；只抓官方頻道 uploads）
    key = str(env.get("YOUTUBE_API_KEY", "") or "").strip()
    if key:
        stats["api"] = True
        for pid, chans in OFFICIAL_CHANNELS.items():
            y = chans.get("youtube")
            if not y or not y.get("handle"):
                continue
            try:
                for v in api_uploads(session, key, y["handle"], state):
                    if v["video_id"] in seen_vids:
                        continue
                    seen_vids.add(v["video_id"])
                    items.append(build_video_item(by_id[pid], v["video_id"], v["title"], y["label"].replace(" YouTube", ""),
                                                  published_at=v["published_at"], thumbnail=v["thumbnail"],
                                                  discovered_via="YouTube Data API", make_item=make_item,
                                                  sentiment_fn=sentiment_fn, topics_fn=topics_fn))
            except Exception as ex:  # noqa: BLE001
                stats["error"] = f"api {pid}: {str(ex)[:100]}"

    # 2) 官網頁面 → YouTube 影片（oEmbed 驗證頻道＝官方才收）＋官網貼出的 FB／IG／Threads 貼文連結
    budget = OEMBED_MAX_PER_ROUND
    for pid, page in (pages if pages is not None else OFFICIAL_PAGES):
        person = by_id.get(pid)
        if not person or not gate.allowed(page):
            continue
        try:
            r = session.get(page, timeout=(5, 20))
            stats["pages_checked"] += 1
            if r.status_code != 200:
                continue
            html = r.text[:PAGE_MAX_BYTES]
        except Exception:  # noqa: BLE001
            continue
        host_label = urlparse(page).netloc.replace("www.", "")
        for lk in extract_meta_post_links(html, page):
            plat = "facebook" if "facebook.com" in lk["url"] else ("instagram" if "instagram.com" in lk["url"] else "threads")
            items.append(make_item(
                person=person, platform=plat, source_name=f"{person['name']}官網（{host_label}）→{plat} 貼文連結",
                url=lk["url"], title=f"{person['name']}官網引用：{lk['label']}",
                summary=f"{person['name']}官網頁面貼出的{plat}貼文連結（本站未向 Meta 請求內容；以原連結為準）",
                published_at=None, is_own_speech=True, sentiment_fn=sentiment_fn, topics_fn=topics_fn,
                extra={"source_type": "official_social", "display_label": "本人發言（官方社群連結）",
                       "counts_in_stats": False, "date_source": "unknown", "image_url": None,
                       "discovered_via": page}))
            stats["meta_post_links"] += 1
        official_author = official_youtube_author(pid)
        for vid in extract_youtube_ids(html):
            if vid in seen_vids:
                continue
            info = cache.get(vid)
            if info is None:
                if budget <= 0 or not gate.allowed("https://www.youtube.com/oembed"):
                    continue
                budget -= 1
                try:
                    info = fetch_oembed(session, vid)
                    stats["oembed_fetched"] += 1
                except Exception:  # noqa: BLE001
                    continue
                time.sleep(POLITE_INTERVAL_SEC)
                if info and "_error" not in info:
                    cache[vid] = info
            if not info or "_error" in info:
                continue
            if not official_author or _norm_author(info.get("author_url")) != official_author:
                continue  # 他人頻道（例：支持者見證影片）不歸為候選人本人
            seen_vids.add(vid)
            label = (OFFICIAL_CHANNELS[pid]["youtube"]["label"]).replace(" YouTube", "")
            items.append(build_video_item(person, vid, info.get("title") or "", label,
                                          thumbnail=info.get("thumbnail_url"), discovered_via=f"官網連結 {host_label}",
                                          make_item=make_item, sentiment_fn=sentiment_fn, topics_fn=topics_fn))
    save_state(state)
    for p in PERSONS:
        mine = [i for i in items if i["person_id"] == p["id"]]
        dated = sorted([i["published_at"] for i in mine if i.get("published_at")], reverse=True)
        stats["per_person"][p["id"]] = {"items": len(mine), "newest_published_at": dated[0] if dated else None}
    stats["ok"] = len(items)
    return items, stats
