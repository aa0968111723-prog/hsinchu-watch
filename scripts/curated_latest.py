#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Import work/*/LATEST_*.json into finalize items (re-run every round).

Validate: https url, published_at with tz offset, full tracked name in title,
outlet as source_name (never the agent). Dedupe by URL against existing items.
One item per matching person_id whose full name appears in the title.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

TZ = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parents[1]
NAMES = {"wu": "吳旭智", "xu": "徐欣瑩", "zheng": "鄭朝方"}
NAME_TO_ID = {v: k for k, v in NAMES.items()}


def ok_https(u: str) -> bool:
    u = (u or "").strip().lower()
    return u.startswith("https://") and len(u) > 10


def parse_aware(s: str):
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        return None  # require zone
    return dt.astimezone(TZ)


def item_id(url: str, person_id: str) -> str:
    return hashlib.sha256(f"{url}|{person_id}|curated".encode()).hexdigest()[:16]


def load_curated_files(root: Path = ROOT) -> list[tuple[Path, list]]:
    out = []
    for path in sorted(root.glob("work/*/LATEST_*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(data, list):
            out.append((path, data))
    return out


def curated_items(existing_urls: set[str], root: Path = ROOT) -> tuple[list[dict], dict]:
    existing = {u.rstrip("/") for u in existing_urls if u}
    added = []
    stats = {"files": 0, "raw": 0, "added": 0, "skipped_dup": 0, "skipped_invalid": 0}
    for path, rows in load_curated_files(root):
        stats["files"] += 1
        for raw in rows:
            stats["raw"] += 1
            if not isinstance(raw, dict):
                stats["skipped_invalid"] += 1
                continue
            title = str(raw.get("title") or "").strip()
            url = str(raw.get("url") or "").strip()
            outlet = str(raw.get("outlet") or raw.get("source_name") or "").strip()
            published = parse_aware(raw.get("published_at"))
            if not title or not ok_https(url) or not outlet or not published:
                stats["skipped_invalid"] += 1
                continue
            # persons: candidates list or candidate string; must appear in title
            cands = []
            if isinstance(raw.get("candidates"), list):
                cands.extend(str(x) for x in raw["candidates"])
            if raw.get("candidate"):
                cands.append(str(raw["candidate"]))
            person_ids = []
            for name in cands:
                pid = NAME_TO_ID.get(name)
                if pid and name in title and pid not in person_ids:
                    person_ids.append(pid)
            # also scan title for any tracked name
            for pid, name in NAMES.items():
                if name in title and pid not in person_ids:
                    person_ids.append(pid)
            if not person_ids:
                stats["skipped_invalid"] += 1
                continue
            url_key = url.rstrip("/")
            if url_key in existing:
                stats["skipped_dup"] += 1
                continue
            # mark URL seen so multi-person from same curated row still both add
            # but second person same URL is OK (different person_id items)
            image = str(raw.get("image_url") or "").strip()
            if image and not ok_https(image):
                image = ""
            for pid in person_ids:
                # per-person URL dedupe: same url+person already in existing
                # check against existing items urls only once for first person;
                # allow multi-person rows
                it = {
                    "id": item_id(url, pid),
                    "person_id": pid,
                    "person": NAMES[pid],
                    "platform": "news",
                    "source_name": outlet,  # never the agent
                    "url": url,
                    "title": title[:200],
                    "summary": str(raw.get("summary") or "")[:400],
                    "published_at": published.isoformat(),
                    "collected_at": datetime.now(TZ).isoformat(),
                    "first_seen_at": published.isoformat(),
                    "topics": [],
                    "sentiment": "neu",
                    "engagement": None,
                    "is_own_speech": False,
                    "anonymous_excerpt": None,
                    "type": "news",
                    "curated": True,
                    "curated_from": str(path.relative_to(root)),
                }
                if image:
                    it["image_url"] = image
                added.append(it)
            existing.add(url_key)
            stats["added"] += len(person_ids)
    return added, stats


if __name__ == "__main__":
    items, st = curated_items(set())
    print(st, "sample", items[0] if items else None)
