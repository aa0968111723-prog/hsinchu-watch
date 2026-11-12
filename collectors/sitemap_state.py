# -*- coding: utf-8 -*-
"""官網 sitemap 增量狀態（PERF patch_r7）。

狀態檔預設：DATA_DIR / sitemap_fetch_state.json
- 可覆寫：環境變數 HSINCHU_SITEMAP_STATE_PATH
- 主線放 /workspace/hsinchu-watch-backups/state/（routine 設定）；不進 git、不上 Cloudflare Pages。
- v2：每個 URL 存 lastmod＋seen_at，通過的文章本體（article）或 rejected 標記；每站上限 MAX_URLS_PER_SITE。
- 無個資；僅 URL + lastmod。
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from collectors.config import DATA_DIR

STATE_VERSION = 2


def state_path() -> Path:
    raw = (os.environ.get("HSINCHU_SITEMAP_STATE_PATH") or "").strip()
    if raw:
        return Path(raw)
    return Path(DATA_DIR) / "sitemap_fetch_state.json"


def empty_state() -> dict[str, Any]:
    return {"version": STATE_VERSION, "sites": {}}


def load_state(path: Path | None = None) -> dict[str, Any]:
    """讀取狀態；缺檔或損壞 → 空狀態（呼叫端應退回完整抓取，仍受 N／deadline 限制）。"""
    p = path or state_path()
    try:
        if not p.is_file():
            return empty_state()
        raw = p.read_text(encoding="utf-8")
        obj = json.loads(raw)
        if not isinstance(obj, dict):
            return empty_state()
        sites = obj.get("sites")
        if sites is None:
            sites = {}
        if not isinstance(sites, dict):
            return empty_state()
        # 正規化每個 site 的 urls
        clean_sites: dict[str, Any] = {}
        for sk, sv in sites.items():
            if not isinstance(sv, dict):
                continue
            urls = sv.get("urls") if isinstance(sv.get("urls"), dict) else {}
            clean_urls = {}
            for u, meta in urls.items():
                if not isinstance(u, str) or not u:
                    continue
                if isinstance(meta, dict):
                    ent = {"lastmod": str(meta.get("lastmod") or "")}
                    if isinstance(meta.get("article"), dict):
                        ent["article"] = meta["article"]
                    if meta.get("rejected"):
                        ent["rejected"] = True
                    if meta.get("seen_at"):
                        ent["seen_at"] = str(meta["seen_at"])
                    clean_urls[u] = ent
                elif isinstance(meta, str):
                    clean_urls[u] = {"lastmod": meta}
            clean_sites[str(sk)] = {"urls": clean_urls}
        return {"version": STATE_VERSION, "sites": clean_sites}
    except Exception:
        return empty_state()


# 每站最多保留幾筆 URL；超過時丟最舊（seen_at 最早）的，避免狀態檔無限長大
MAX_URLS_PER_SITE = int(os.environ.get("HSINCHU_SITEMAP_STATE_MAX_URLS", "500"))


def _cap_sites(sites: dict[str, Any], cap: int) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for sk, block in (sites or {}).items():
        urls = dict((block or {}).get("urls") or {})
        if cap > 0 and len(urls) > cap:
            keep = sorted(urls.items(), key=lambda kv: str((kv[1] or {}).get("seen_at") or ""), reverse=True)[:cap]
            urls = dict(keep)
        out[sk] = {"urls": urls}
    return out


def save_state(state: dict[str, Any], path: Path | None = None) -> None:
    """原子寫入：同目錄唯一暫存檔 → fsync → os.replace；中途被殺也不會留下半個檔。"""
    import tempfile
    p = path or state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": STATE_VERSION,
        "sites": _cap_sites((state or {}).get("sites") or {}, MAX_URLS_PER_SITE),
    }
    fd, tmpname = tempfile.mkstemp(prefix=p.name + ".", suffix=".tmp", dir=str(p.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmpname, p)
    except BaseException:
        try:
            os.unlink(tmpname)  # 只清自己剛建的暫存檔
        except OSError:
            pass
        raise


def site_key(official_website: str | None) -> str:
    return (official_website or "").rstrip("/") + "/"


def seen_urls_for(state: dict[str, Any], official_website: str | None) -> dict[str, dict[str, str]]:
    sk = site_key(official_website)
    block = ((state or {}).get("sites") or {}).get(sk) or {}
    urls = block.get("urls") if isinstance(block, dict) else {}
    return urls if isinstance(urls, dict) else {}


def should_fetch(url: str, lastmod: str, seen: dict[str, dict[str, str]]) -> bool:
    """True = 需要抓正文。已看過且 lastmod 未變 → False。"""
    prev = seen.get(url)
    if prev is None:
        return True
    # 舊格式（只有 lastmod、沒存文章也沒標 rejected）→ 重抓一次，以免「已看過但文章不在資料裡」
    if not isinstance(prev, dict) or ("article" not in prev and not prev.get("rejected")):
        return True
    prev_lm = str((prev or {}).get("lastmod") or "")
    cur_lm = str(lastmod or "")
    return prev_lm != cur_lm


def mark_seen(state: dict[str, Any], official_website: str | None, url: str, lastmod: str,
              article: dict[str, Any] | None = None, rejected: bool = False) -> None:
    """標已看過。article：通過篩選的文章（之後各輪直接沿用、不重抓）；rejected：已評估但不收的頁。"""
    from datetime import datetime, timezone
    sk = site_key(official_website)
    sites = state.setdefault("sites", {})
    block = sites.setdefault(sk, {"urls": {}})
    urls = block.setdefault("urls", {})
    ent: dict[str, Any] = {"lastmod": str(lastmod or ""),
                           "seen_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    if article is not None:
        ent["article"] = article
    else:
        ent["rejected"] = True
    urls[url] = ent


def cached_article(seen: dict[str, dict[str, Any]], url: str) -> dict[str, Any] | None:
    ent = seen.get(url)
    art = ent.get("article") if isinstance(ent, dict) else None
    return dict(art) if isinstance(art, dict) else None
