"""Write the measured baseline and fail when retained data or navigation drifts."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from baseline import collect

REPORT = Path(__file__).resolve().parent / "reports" / "baseline.json"


def main():
    report = collect()
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    summary = {
        "problems": report["problems"],
        "payload_files": report["measured"]["payload_files"],
        "items_rows": report["measured"]["items_rows"],
        "policies": report["measured"]["policies"],
        "source_index_entries": report["measured"]["source_index_entries"],
        "archive_rows": report["measured"]["archive_rows"],
        "comment_entries": report["measured"]["comment_entries"],
        "report": str(REPORT),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 1 if report["problems"] else 0


if __name__ == "__main__":
    sys.exit(main())
