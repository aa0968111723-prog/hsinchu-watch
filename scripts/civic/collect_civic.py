"""Run one civic collection cycle.

The operating-system task calls this every 20 minutes. Each source still has
its own interval, so a 20-minute tick does not mean every site is downloaded.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from collectors.civic.cycle import civic_dir, run_cycle
from collectors.civic.fetch import fetch
from collectors.civic.textutil import TZ, now_iso

TASK_NAME = "HsinchuWatch-02-data-civic"


class _Failure(RuntimeError):
    pass


def _fetch_with_drill(drill: str | None):
    def _fetch(spec, state):
        if drill and spec["id"] == drill:
            raise _Failure("drill_failure")
        return fetch(spec, state)
    return _fetch


def record_schedule(root: Path) -> dict:
    query = subprocess.run(
        ["schtasks", "/Query", "/TN", TASK_NAME, "/FO", "LIST"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=False,
    )
    output = (query.stdout or "") + (query.stderr or "")
    enabled = query.returncode == 0 and "Disabled" not in output and "已停用" not in output
    found = query.returncode == 0
    document = {
        "schema_version": 1,
        "task_name": TASK_NAME,
        "code_ready": True,
        "interval_minutes": 20,
        "schedule_defined": True,
        "os_task_found": found,
        "os_task_enabled": bool(found and enabled),
        "queried_at": now_iso(datetime.now(TZ)),
        "query_exit_code": query.returncode,
        "query_excerpt": output.strip()[:1000],
        "production_published": False,
        "production_note": "本線只準備資料與本機排程。正式站發布由第四線整合，排程存在不等於已經發布。",
    }
    target = civic_dir(root) / "schedule.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return document


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="ignore next_due_at")
    parser.add_argument("--drill-failure", default="", help="fail one source id without deleting its records")
    parser.add_argument("--record-schedule", action="store_true")
    parser.add_argument("--schedule-only", action="store_true")
    args = parser.parse_args()
    if args.schedule_only:
        print(json.dumps(record_schedule(ROOT), ensure_ascii=False))
        return
    summary = run_cycle(
        root=ROOT,
        now=datetime.now(TZ),
        fetch=_fetch_with_drill(args.drill_failure or None),
        force=args.force or bool(args.drill_failure),
    )
    schedule = record_schedule(ROOT) if args.record_schedule else None
    print(json.dumps({
        "status": summary["status"],
        "records": summary["records"],
        "content_hash": summary["feed"]["content_hash"],
        "last_success_at": summary["feed"]["last_success_at"],
        "sources": summary["reports"],
        "schedule_enabled": None if schedule is None else schedule["os_task_enabled"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
