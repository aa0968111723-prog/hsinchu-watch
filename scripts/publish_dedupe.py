#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Publish-time display dedupe (ACCURACY_1110).

Does NOT delete raw data/. For published output, collapses each near-duplicate
group to one keep (prefer non-Google-News, then earliest), and lists other
outlets on also_reported_by. Re-runs every finalize round.
"""
from __future__ import annotations

import hashlib
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

TZ = timezone(timedelta(hours=8))
_WS_RE = re.compile(r"\s+")
_PUNCT_RE = re.compile(r"[^\w\u4e00-\u9fff]+", re.UNICODE)
_MOBILE_HOST_RE = re.compile(r"^(?:m|mobile|amp)\.", re.I)
_AMP_HOST_RE = re.compile(r"^amp\.", re.I)
_AMP_PATH_RES = (re.compile(r"/amp/?$", re.I), re.compile(r"^/amp/", re.I))
_TRACKING_KEYS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "mc_cid", "mc_eid", "igshid",
}
_TRACKING_PREFIXES = ("utm_",)
CANNED_SUMMARIES = {"", "（無摘要）"}
PERSON_ORDER = ("wu", "xu", "zheng")
NAMES = {"wu": "吳旭智", "xu": "徐欣瑩", "zheng": "鄭朝方"}


def normalize_url(url: str | None) -> str | None:
    if not url:
        return None
    url = url.strip()
    try:
        p = urlparse(url)
        if not p.scheme or not p.netloc:
            return None
        host = p.netloc.lower()
        if host.endswith(":80") or host.endswith(":443"):
            host = host.rsplit(":", 1)[0]
        host = _MOBILE_HOST_RE.sub("", host)
        host = _AMP_HOST_RE.sub("", host)
        if host.startswith("www."):
            host = host[4:]
        path = p.path or "/"
        for rx in _AMP_PATH_RES:
            path = rx.sub("/", path)
        path = re.sub(r"/{2,}", "/", path)
        if path != "/" and path.endswith("/"):
            path = path[:-1]
        kept = []
        for k, v in parse_qsl(p.query, keep_blank_values=True):
            kl = k.lower()
            if kl in _TRACKING_KEYS or any(kl.startswith(pref) for pref in _TRACKING_PREFIXES):
                continue
            kept.append((kl, v))
        kept.sort()
        return urlunparse(("https", host, path, "", urlencode(kept, doseq=False), ""))
    except Exception:
        return url.strip() or None


def _normalize_text(text: str | None) -> str:
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text)
    t = _WS_RE.sub("", t)
    t = _PUNCT_RE.sub("", t)
    return t.lower()


def content_fingerprint(title: str | None, summary: str | None = None, *, n: int = 48) -> str:
    blob = _normalize_text(title) + "|" + _normalize_text(summary)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:n]


def title_similarity(a: str | None, b: str | None) -> float:
    def grams(s: str) -> set[str]:
        s = _normalize_text(s)
        if len(s) < 2:
            return {s} if s else set()
        return {s[i : i + 2] for i in range(len(s) - 1)}

    ga, gb = grams(a or ""), grams(b or "")
    if not ga or not gb:
        return 0.0
    inter = len(ga & gb)
    union = len(ga | gb)
    return inter / union if union else 0.0


def is_gnews(url: str | None) -> bool:
    try:
        return "news.google." in (urlparse(url or "").netloc.lower())
    except Exception:
        return False


def parse_day(s: str | None):
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TZ)
        return dt.astimezone(TZ)
    except Exception:
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(s))
        if m:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=TZ)
        return None


def _item_time(it: dict) -> str:
    return str(it.get("published_at") or it.get("first_seen_at") or it.get("collected_at") or "")


def pick_keep(members: list[dict]) -> dict:
    """Prefer non-GN, then earliest, then person whose name is in title (wu→xu→zheng)."""
    title = " ".join(str(m.get("title") or "") for m in members)

    def key(m: dict):
        pid = m.get("person_id")
        name_in = 0 if (pid in NAMES and NAMES[pid] in (m.get("title") or title)) else 1
        order = PERSON_ORDER.index(pid) if pid in PERSON_ORDER else 99
        return (
            0 if not is_gnews(m.get("url")) else 1,
            _item_time(m) or "9999",
            name_in,
            order,
            -len(m.get("summary") or ""),
            str(m.get("id") or ""),
        )

    return sorted(members, key=key)[0]


def find_dup_groups(items: list[dict]) -> list[list[dict]]:
    n = len(items)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    by_url: dict[str, list[int]] = defaultdict(list)
    for i, it in enumerate(items):
        u = normalize_url(it.get("url"))
        if u:
            by_url[u].append(i)
    for idxs in by_url.values():
        for j in idxs[1:]:
            union(idxs[0], j)

    by_fp: dict[str, list[int]] = defaultdict(list)
    for i, it in enumerate(items):
        summary = (it.get("summary") or "").strip()
        if summary in CANNED_SUMMARIES:
            continue
        if summary.startswith("PTT ") and "搜尋" in summary:
            continue
        if not _normalize_text(it.get("title")):
            continue
        fp = content_fingerprint(it.get("title"), it.get("summary"))
        by_fp[fp].append(i)
    for idxs in by_fp.values():
        if len(idxs) < 2:
            continue
        for j in idxs[1:]:
            union(idxs[0], j)

    days = []
    for it in items:
        dt = parse_day(it.get("published_at"))
        days.append(dt.date().isoformat() if dt else None)

    for i in range(n):
        for j in range(i + 1, n):
            if find(i) == find(j):
                continue
            di, dj = days[i], days[j]
            if di and dj:
                d1 = datetime.fromisoformat(di).date()
                d2 = datetime.fromisoformat(dj).date()
                if abs((d1 - d2).days) > 1:
                    continue
            if title_similarity(items[i].get("title"), items[j].get("title")) < 0.82:
                continue
            union(i, j)

    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        groups[find(i)].append(i)
    return [[items[i] for i in idxs] for idxs in groups.values() if len(idxs) >= 2]


def display_dedupe(items: list[dict]) -> tuple[list[dict], dict]:
    """Collapse each dup group to one keep; others become also_reported_by links."""
    if not items:
        return [], {"groups": 0, "removed": 0, "kept": 0, "input": 0}

    groups = find_dup_groups(items)
    remove_ids: set[str] = set()
    enrich: dict[str, dict] = {}

    for members in groups:
        keep = pick_keep(members)
        kid = str(keep.get("id"))
        also = []
        related_persons = []
        for m in members:
            mid = str(m.get("id"))
            if mid == kid:
                continue
            remove_ids.add(mid)
            also.append({
                "source_name": m.get("source_name") or m.get("platform") or "其他來源",
                "url": m.get("url"),
                "title": m.get("title"),
                "person_id": m.get("person_id"),
                "id": m.get("id"),
            })
            if m.get("person_id") and m.get("person_id") not in related_persons:
                related_persons.append(m.get("person_id"))
        if keep.get("person_id") and keep.get("person_id") not in related_persons:
            related_persons.insert(0, keep.get("person_id"))
        enrich[kid] = {
            "also_reported_by": also,
            "related_persons": related_persons,
            "duplicate_group_keep": kid,
        }

    out = []
    for it in items:
        iid = str(it.get("id"))
        if iid in remove_ids:
            continue
        row = dict(it)
        if iid in enrich:
            row.update(enrich[iid])
        out.append(row)

    return out, {
        "groups": len(groups),
        "removed": len(remove_ids),
        "kept": len(out),
        "input": len(items),
    }


def items_for_person(items: list[dict], person_id: str) -> list[dict]:
    """Person page: own rows plus merged stories that name this person / related_persons."""
    name = NAMES.get(person_id, "")
    out = []
    for it in items:
        if it.get("person_id") == person_id:
            out.append(it)
            continue
        rel = it.get("related_persons") or []
        title = it.get("title") or ""
        also = it.get("also_reported_by") or []
        if person_id in rel or (name and name in title) or any(a.get("person_id") == person_id for a in also):
            row = dict(it)
            row["person_id"] = person_id
            row["person"] = name
            row["via_related_event"] = True
            out.append(row)
    return out


if __name__ == "__main__":
    import json
    path = sys.argv[1] if len(sys.argv) > 1 else "public/data/items.json"
    items = json.loads(open(path, encoding="utf-8").read())
    out, st = display_dedupe(items)
    print(st)
    from collections import Counter
    print("before", dict(Counter(i.get("person_id") for i in items)))
    print("after", dict(Counter(i.get("person_id") for i in out)))
