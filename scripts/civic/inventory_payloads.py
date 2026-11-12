"""Count legacy payloads without rewriting them."""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

ROOT_FOR_IMPORT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT_FOR_IMPORT))

from collectors.civic.textutil import TZ, now_iso

TASK_BASELINE = {
    "items_rows": 9164,
    "source_index_rows": 7205,
    "policy_rows": 1879,
    "archive_page_rows": 18422,
    "note": "任務書記載的已發布基準。本腳本另計目前工作區看得到的檔案，兩者不相符時以檔案為準並標成缺口，不用基準數字覆蓋。",
}


def _count_json(path: Path) -> dict:
    info = {"path": path.as_posix(), "bytes": path.stat().st_size}
    if path.stat().st_size > 40_000_000:
        info["count"] = None
        info["count_note"] = "檔案過大，這次只記位元組，沒有整檔解析。"
        return info
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        info["count"] = None
        info["count_note"] = f"讀取失敗：{error.__class__.__name__}"
        return info
    if isinstance(payload, list):
        info["count"] = len(payload)
        info["shape"] = "list"
    elif isinstance(payload, dict):
        info["shape"] = "object"
        info["keys"] = len(payload)
        for key in ("records", "articles", "entries", "projects", "sources", "items"):
            if isinstance(payload.get(key), list):
                info[f"{key}_count"] = len(payload[key])
        by_person = payload.get("by_person")
        if isinstance(by_person, dict):
            info["by_person_item_count"] = sum(
                len(person.get("items") or []) for person in by_person.values() if isinstance(person, dict)
            )
    else:
        info["count"] = None
        info["shape"] = type(payload).__name__
    return info


def inventory(root: Path, now: datetime | None = None) -> dict:
    moment = now or datetime.now(TZ)
    data_root = root / "public" / "data"
    observation_root = root / "public" / "observations"
    files = []
    if data_root.exists():
        files.extend(path for path in data_root.rglob("*.json") if "civic" not in path.parts)
    if observation_root.exists():
        files.extend(observation_root.rglob("*.json"))
    files = sorted(files)
    counted = [_count_json(path) for path in files]
    governance_path = data_root / "governance.json"
    projects = []
    if governance_path.exists():
        payload = json.loads(governance_path.read_text(encoding="utf-8"))
        for project in payload.get("projects") or []:
            budget = project.get("budget") or {}
            projects.append({
                "id": project.get("id"),
                "region_id": project.get("region_id"),
                "legacy_file": "public/data/governance.json",
                "evidence_source_ids": sorted({
                    *(event.get("source_id") for event in project.get("events") or [] if event.get("source_id")),
                    *([budget.get("source_id")] if isinstance(budget, dict) and budget.get("source_id") else []),
                }),
                "spent_twd": budget.get("spent_twd") if isinstance(budget, dict) else None,
                "progress_value": (project.get("progress") or {}).get("value") if isinstance(project.get("progress"), dict) else None,
                "geometry": None,
                "location_precision": "unknown",
                "note": "參照既有案卷。spent 為 null 時保持 null。這裡不產生座標。",
            })
    document = {
        "schema_version": 1,
        "generated_at": now_iso(moment),
        "task_baseline": TASK_BASELINE,
        "observed_file_count": len(counted),
        "files": [
            {
                "path": path.relative_to(root).as_posix(),
                "bytes": item["bytes"],
                "shape": item.get("shape"),
                "count": item.get("count"),
                "count_note": item.get("count_note"),
                "list_counts": {
                    key: value for key, value in item.items() if key.endswith("_count")
                },
            }
            for path, item in zip(sorted(files), counted)
        ],
        "projects": projects,
        "preserved_note": "此盤點不寫入 public/data 既有 JSON，也不寫入 observations。",
    }
    target = root / "public" / "data" / "civic" / "legacy-index.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(target)
    return document


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    document = inventory(root)
    print(json.dumps({
        "files": document["observed_file_count"],
        "projects": len(document["projects"]),
        "written": "public/data/civic/legacy-index.json",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
