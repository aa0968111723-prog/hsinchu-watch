# -*- coding: utf-8 -*-
"""把已核對政績、政見追加進正式站 policies.json。不刪既有筆，不發明內容。"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = Path(r"D:/GitHub/hsinchu-watch/work/Hermes協助Grok")
NAMES = {"吳旭智": "wu", "徐欣瑩": "xu", "鄭朝方": "zheng", "邱臣遠": "chiu"}
TOPIC_MAP = {"社宅": "住宅", "長照": "醫療", "客家": "農業"}
FILES = ["policy-seed.json", "policy-records.json", "policy-stances.json", "policy-stances-grok.json", "grok-continue.json"]


def load_list(path: Path) -> list:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else list(data.get("items") or [])


def make(row: dict) -> dict | None:
    if str(row.get("kind") or "") in ("news", "新聞"):
        return None
    person = str(row.get("person") or "")
    pid = NAMES.get(person)
    url = str(row.get("url") or "").strip()
    date = str(row.get("date") or "").strip()
    title = str(row.get("title") or "").strip()
    source = str(row.get("source") or "").strip()
    if not pid or not url.startswith("http") or len(date) != 10 or not title or not source:
        return None
    today = datetime.now().astimezone().date().isoformat()
    if date < "2026-01-01" or date > today:
        return None
    kind = "record" if row.get("kind") in ("record", "政績") else "policy"
    topic = TOPIC_MAP.get(str(row.get("topic") or "").strip(), str(row.get("topic") or "").strip())
    summary = str(row.get("summary") or "").strip()
    if topic and topic not in summary and topic not in title:
        summary = f"{topic}：{summary}"[:80]
    return {
        "id": "hp" + hashlib.sha1(f"{pid}|{kind}|{url}|{title}".encode("utf-8")).hexdigest()[:10],
        "person_id": pid,
        "kind": kind,
        "title": title[:80],
        "summary": summary[:80],
        "source_name": source[:40],
        "source_url": url,
        "url": url,
        "published_at": f"{date}T08:00:00+08:00",
        "date_precision": "day",
        "source_type": "新聞",
        "note": "公開報導說法，成效數字未獨立查核。",
        "checked_at": "2026-11-10",
    }


def main() -> int:
    targets = [ROOT / "dist" / "data" / "policies.json", ROOT / "data" / "policies.json"]
    fresh = []
    for name in FILES:
        for row in load_list(SOURCE_DIR / name):
            item = make(row)
            if item:
                fresh.append(item)
    added = 0
    for path in targets:
        rows = load_list(path)
        seen = {(r.get("person_id"), r.get("kind"), r.get("source_url"), r.get("title")) for r in rows}
        n = 0
        for item in fresh:
            key = (item["person_id"], item["kind"], item["source_url"], item["title"])
            if key in seen:
                continue
            rows.append(item)
            seen.add(key)
            n += 1
        if path.parent.exists() or path == targets[0]:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        added = max(added, n)
        print(path.name, "added", n, "total", len(rows))
    print(json.dumps({"added": added, "fresh": len(fresh)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
