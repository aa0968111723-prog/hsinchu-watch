# -*- coding: utf-8 -*-
"""把 Hermes 已核對來源追加進正式站資料。不刪既有筆、不新增民調數字。"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = Path(r"D:/GitHub/hsinchu-watch/work/Hermes協助Grok")
DATA_ITEMS = ROOT / "data" / "items.json"
DIST = ROOT / "dist" / "data"
NAMES = {
    "鄭朝方": "zheng",
    "徐欣瑩": "xu",
    "吳旭智": "wu",
    "邱臣遠": "chiu",
}
PORTRAITS = {
    "zheng": "https://hsinchu-watch.pages.dev/img/persons/zheng.jpg",
    "xu": "https://hsinchu-watch.pages.dev/img/persons/xu.jpg",
    "wu": "https://hsinchu-watch.pages.dev/img/persons/wu.jpg",
    "chiu": "https://hsinchu-watch.pages.dev/img/persons/chiu.jpg",
}
SOURCE_FILES = [
    "public-sources-rolling.json",
    "wu-zijia-sources.json",
    "agent-chiu.json",
    "agent-wuzijia.json",
    "agent-zheng-xu.json",
    "agent-wu-chen.json",
    "public-sources-bulk.json",
    "public-sources-7d-expanded.json",
    "public-sources-7d.json",
    "grok-continue.json",
]


def load_items(path: Path) -> list:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else list(data.get("items") or [])


def assign_person(row: dict) -> tuple[str, str] | None:
    person = str(row.get("person") or "")
    blob = f"{row.get('title') or ''} {row.get('evidence') or ''}"
    if person in NAMES:
        return person, NAMES[person]
    if person == "陳見賢":
        for name, pid in NAMES.items():
            if name in blob:
                return name, pid
    return None


def make_item(row: dict, person: str, pid: str, now: str) -> dict | None:
    url = str(row.get("url") or "").strip()
    date = str(row.get("date") or "").strip()
    title = str(row.get("title") or "").strip()
    if not url.startswith("http") or len(date) != 10 or not title:
        return None
    if date < "2026-01-01" or date > now[:10]:
        return None
    evidence = str(row.get("evidence") or "").strip()
    return {
        "id": hashlib.sha1(url.encode("utf-8")).hexdigest()[:16],
        "person": person,
        "person_id": pid,
        "platform": "news",
        "source_name": str(row.get("source") or "公開新聞")[:80],
        "published_at": f"{date}T08:00:00+08:00",
        "collected_at": now,
        "first_seen_at": now,
        "url": url,
        "title": title[:180],
        "summary": (evidence or title)[:180],
        "topics": [],
        "sentiment": "neu",
        "engagement": None,
        "is_own_speech": False,
        "anonymous_excerpt": None,
        "review_status": "ok",
        "image_url": PORTRAITS[pid],
        "downrank": False,
        "filter_reason": None,
    }


def append_new(rows: list, fresh: list) -> int:
    seen = {r.get("url") for r in rows}
    added = 0
    for row in fresh:
        if row["url"] in seen:
            continue
        rows.append(row)
        seen.add(row["url"])
        added += 1
    return added


def dump(path: Path, rows: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    data_rows = load_items(DATA_ITEMS)
    seen = {r.get("url") for r in data_rows}
    fresh = []
    skipped_chen = 0
    for name in SOURCE_FILES:
        path = SOURCE_DIR / name
        if not path.exists():
            continue
        for row in load_items(path):
            if row.get("kind") in ("record", "policy", "政績", "政見"):
                continue
            assigned = assign_person(row)
            if assigned is None:
                if row.get("person") == "陳見賢":
                    skipped_chen += 1
                continue
            item = make_item(row, *assigned, now)
            if item and item["url"] not in seen:
                fresh.append(item)
                seen.add(item["url"])
    added = append_new(data_rows, fresh)
    dump(DATA_ITEMS, data_rows)
    dist_items = DIST / "items.json"
    dist_rows = load_items(dist_items) if dist_items.exists() else list(data_rows)
    append_new(dist_rows, fresh)
    dump(dist_items, dist_rows)
    by_id = {"wu": [], "xu": [], "zheng": [], "chiu": []}
    for row in dist_rows:
        pid = row.get("person_id")
        if pid in by_id:
            by_id[pid].append(row)
    for pid, rows in by_id.items():
        dump(DIST / f"items_{pid}.json", rows)
    latest = sorted(dist_rows, key=lambda r: r.get("published_at") or "", reverse=True)[:120]
    dump(DIST / "latest.json", latest)
    print(json.dumps({
        "added": added,
        "data_total": len(data_rows),
        "dist_total": len(dist_rows),
        "chiu": len(by_id["chiu"]),
        "skipped_chen_only": skipped_chen,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
