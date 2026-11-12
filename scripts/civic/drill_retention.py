"""Fail every fetch once and prove the previous civic records stay in place."""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from collectors.civic.cycle import civic_dir, run_cycle
from collectors.civic.textutil import TZ, now_iso


def main() -> None:
    folder = civic_dir(ROOT)
    before = json.loads((folder / "feed.json").read_text(encoding="utf-8"))
    before_records = json.loads((folder / "records.json").read_text(encoding="utf-8"))["records"]

    def fail(spec, state):
        raise RuntimeError("network down")

    summary = run_cycle(root=ROOT, now=datetime.now(TZ), fetch=fail, force=True)
    after = json.loads((folder / "feed.json").read_text(encoding="utf-8"))
    after_records = json.loads((folder / "records.json").read_text(encoding="utf-8"))["records"]
    ok = (
        summary["status"] == "failed"
        and after["content_hash"] == before["content_hash"]
        and after["last_success_at"] == before["last_success_at"]
        and len(after_records) == len(before_records)
    )
    evidence = {
        "checked_at": now_iso(datetime.now(TZ)),
        "retained": ok,
        "status": summary["status"],
        "records": len(after_records),
        "content_hash": after["content_hash"],
        "last_success_at": after["last_success_at"],
        "note": "全部來源模擬連線失敗後，紀錄雜湊與上次成功時間都沒有改。接著應再跑一輪真實搜集，把健康狀態從 error 改回。",
    }
    (folder / "failure-retention.json").write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if not ok:
        raise SystemExit("retention check failed")
    print(json.dumps(evidence, ensure_ascii=False))


if __name__ == "__main__":
    main()
