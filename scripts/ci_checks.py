# -*- coding: utf-8 -*-
"""公開資料隱私／摘錄／出處門檻：python scripts/ci_checks.py（失敗則 exit 1）。"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import os
PUB = Path(os.environ.get("HW_PUB", ROOT / "public" / "data"))
NAMES = {"wu": "吳旭智", "xu": "徐欣瑩", "zheng": "鄭朝方", "chiu": "邱臣遠"}
BAD_KEYS = {"author", "user", "username", "user_name", "handle", "account", "commenter",
            "commenter_id", "commenter_name", "display_name", "screen_name", "userid",
            "user_id", "poster", "nickname", "nick", "avatar"}


def walk(v, path=""):
    if isinstance(v, dict):
        for k, x in v.items():
            yield path + "." + k, k, x
            yield from walk(x, path + "." + k)
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from walk(x, f"{path}[{i}]")


def main():
    errs = []
    for f in sorted(PUB.glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        for p, k, x in walk(data):
            if k in BAD_KEYS:
                errs.append(f"{f.name}{p}: account-like key")
            if k == "anonymous_excerpt" and x and len(str(x)) > 30:
                errs.append(f"{f.name}{p}: excerpt > 30")
    items = json.loads((PUB / "items.json").read_text(encoding="utf-8"))
    for i, it in enumerate(items):
        if not str(it.get("url", "")).lower().startswith(("http://", "https://")) or not it.get("source_name"):
            errs.append(f"items[{i}]: missing source_name/url")
        blob = "".join(str(it.get(k) or "") for k in ("title", "summary", "anonymous_excerpt"))
        if NAMES.get(it.get("person_id"), "\0") not in blob:
            errs.append(f"items[{i}]: assigned person name absent")
    for e in errs[:50]:
        print("FAIL", e)
    print(f"ci_checks: {len(errs)} problem(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
