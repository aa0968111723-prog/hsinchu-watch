"""Rebuild public/data/civic/watch.sqlite from legacy JSON and civic outputs."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from collectors.civic.database import build_database


def main() -> None:
    counts = build_database(ROOT)
    print(json.dumps(counts, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
