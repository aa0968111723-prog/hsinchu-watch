#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""content_hash.py（hsinchu-watch 主線；源自 work/CICD與發布經理/content_hash.py，加 *_checked_at 後綴規則）

對 JSON 目錄做「內容雜湊」：遞迴剝離可設定的 volatile 鍵、鍵排序正規化，
輸出每檔與合併雜湊。用於判斷「資料是否實質變更」以決定是否部署。

對齊主線 scripts/finalize_data.py 的 VOLATILE_KEYS／content_sha 精神；
本草稿獨立交件於 work/CICD與發布經理/，不改主線。

用法：
  python content_hash.py <dir> [--json] [--compare <other_dir_or_hashfile>]
  python content_hash.py --self-test

結束碼：
  0  = 內容相同（或僅計算雜湊成功且未要求 compare 差異）
  10 = --compare 時內容不同
  2  = 用法／I/O 錯誤
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

# 與 finalize_data.VOLATILE_KEYS 對齊，並補上實測會每輪變、但不代表內容變的鍵
DEFAULT_VOLATILE = frozenset(
    {
        "generated_at",
        "finalized_at",
        "collected_at",
        "fetched_at",
        "elapsed_sec",
        "spot_checked_at",
        "verified_at",
        "last_24h",
        "last_7d",
        "attempts",
        "updated_at",
        # manifest 內嵌的 raw 指紋會隨 volatile 位元組變；內容雜湊略過整份 manifest
    }
)

# 任何 *_checked_at（如 spot_checked_at、robots_checked_at）皆視為每輪時間欄
VOLATILE_SUFFIXES = ("_checked_at",)

SKIP_FILES = frozenset({"manifest.json"})  # 與主線 content_sha 相同：不納入合併雜湊


# 依位置剔除（HASH_0307）：只在特定父層下才算每輪時間／環境欄，其他地方同名鍵保留
#   stats.source_status[].last_updated   — 來源狀態「最後更新」時間
#   stats.source_stats.<源>.state_path   — 增量狀態檔的本機路徑（r7）
# 刻意不剔：pending_review_label、published_at、counts、title、url、summary
CONTEXT_VOLATILE = (
    (("source_status", "[]"), "last_updated"),
    (("source_stats", "*"), "state_path"),
)


def _ctx_drop(path: tuple, key: str) -> bool:
    for pat, k in CONTEXT_VOLATILE:
        if k != key or len(path) < len(pat):
            continue
        tail = path[-len(pat):]
        if all(p == "*" or p == t for p, t in zip(pat, tail)):
            return True
    return False


def strip_volatile(obj: Any, volatile: frozenset[str], path: tuple = ()) -> Any:
    if isinstance(obj, dict):
        return {
            k: strip_volatile(v, volatile, path + (k,))
            for k, v in obj.items()
            if k not in volatile and not k.endswith(VOLATILE_SUFFIXES) and not _ctx_drop(path, k)
        }
    if isinstance(obj, list):
        return [strip_volatile(v, volatile, path + ("[]",)) for v in obj]
    return obj


def _auto_sort_key(items: list) -> str | None:
    """list[dict] 若每筆都有非空 id（否則 url）就依它排序；都沒有則保留原順序。"""
    for k in ("id", "url"):
        if all(isinstance(x, dict) and x.get(k) not in (None, "") for x in items):
            return k
    return None


def canonicalize(
    obj: Any,
    *,
    volatile: frozenset[str],
    sort_lists_by: str | None,
    _stripped: bool = False,
) -> Any:
    """先剔除 volatile，再鍵排序；sort_lists_by="auto"（預設）時 list[dict] 依 id／url 穩定排序。"""
    if not _stripped:
        obj = strip_volatile(obj, volatile)
    if isinstance(obj, dict):
        return {
            k: canonicalize(obj[k], volatile=volatile, sort_lists_by=sort_lists_by, _stripped=True)
            for k in sorted(obj.keys())
        }
    if isinstance(obj, list):
        items = [
            canonicalize(v, volatile=volatile, sort_lists_by=sort_lists_by, _stripped=True) for v in obj
        ]
        key = _auto_sort_key(items) if sort_lists_by == "auto" else sort_lists_by
        if key and items and all(isinstance(x, dict) for x in items):
            items = sorted(
                items,
                key=lambda x: (
                    "" if x.get(key) is None else str(x.get(key)),
                    json.dumps(x, ensure_ascii=False, sort_keys=True),
                ),
            )
        return items
    return obj


def dumps_canonical(obj: Any) -> bytes:
    # separators 固定，避免空白差異；ensure_ascii=False 保留中文
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def iter_json_files(dir_path: Path) -> list[Path]:
    return sorted(p for p in dir_path.glob("*.json") if p.is_file())


def hash_dir(
    dir_path: Path,
    *,
    volatile: frozenset[str],
    sort_lists_by: str | None,
    include_manifest: bool = False,
) -> dict[str, Any]:
    if not dir_path.is_dir():
        raise FileNotFoundError(f"not a directory: {dir_path}")
    per_file: dict[str, dict[str, str]] = {}
    combo = hashlib.sha256()
    for path in iter_json_files(dir_path):
        name = path.name
        raw = path.read_bytes()
        raw_sha = sha256_hex(raw)
        try:
            obj = json.loads(raw.decode("utf-8"))
            canon = canonicalize(obj, volatile=volatile, sort_lists_by=sort_lists_by)
            content = sha256_hex(dumps_canonical(canon))
        except Exception as exc:  # noqa: BLE001 — 交件工具：記錄錯誤雜湊
            content = f"ERROR:{type(exc).__name__}"
        per_file[name] = {"raw_sha256": raw_sha, "content_sha256": content}
        if name in SKIP_FILES and not include_manifest:
            continue
        if content.startswith("ERROR:"):
            continue
        combo.update(name.encode("utf-8"))
        combo.update(b"\0")
        combo.update(content.encode("utf-8"))
        combo.update(b"\n")
    return {
        "dir": str(dir_path.resolve()),
        "volatile_keys": sorted(volatile),
        "sort_lists_by": sort_lists_by,
        "files": per_file,
        "combined_content_sha256": combo.hexdigest(),
    }


def load_compare_target(spec: str, *, volatile: frozenset[str], sort_lists_by: str | None) -> dict[str, Any]:
    p = Path(spec)
    if p.is_dir():
        return hash_dir(p, volatile=volatile, sort_lists_by=sort_lists_by)
    if p.is_file():
        text0 = p.read_text(encoding="utf-8")
        try:
            data = json.loads(text0)
        except ValueError:
            data = None  # 純文字雜湊檔（deploy.sh 寫入的單行 hex）
        if isinstance(data, dict) and "combined_content_sha256" in data:
            return data
        # 純文字一行雜湊
        text = p.read_text(encoding="utf-8").strip().splitlines()[0].strip()
        return {"combined_content_sha256": text, "files": {}, "dir": str(p)}
    # 當作字面雜湊
    if len(spec) >= 32 and all(c in "0123456789abcdef" for c in spec.lower()):
        return {"combined_content_sha256": spec.lower(), "files": {}, "dir": "<literal>"}
    raise FileNotFoundError(f"compare target not found: {spec}")


def self_test() -> int:
    import tempfile

    volatile = DEFAULT_VOLATILE
    with tempfile.TemporaryDirectory(prefix="content_hash_selftest_") as td:
        root = Path(td)
        a = root / "a"
        b = root / "b"
        a.mkdir()
        b.mkdir()
        payload = {
            "generated_at": "2026-11-10T02:10:00+08:00",
            "finalized_at": "2026-11-10T02:10:01+08:00",
            "items": [
                {
                    "url": "https://example.com/1",
                    "title": "甲",
                    "collected_at": "2026-11-10T02:10:00+08:00",
                },
                {
                    "url": "https://example.com/2",
                    "title": "乙",
                    "collected_at": "2026-11-10T02:10:00+08:00",
                },
            ],
            "by_person": {"wu": {"last_24h": 1, "last_7d": 2, "total": 3}},
        }
        (a / "items.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        (a / "manifest.json").write_text(
            json.dumps(
                {
                    "generated_at": payload["generated_at"],
                    "files": {"items.json": {"sha256": "dead"}},
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        # b：只改時間／last_*／manifest raw 指紋
        payload2 = json.loads(json.dumps(payload))
        payload2["generated_at"] = "2026-11-10T02:26:00+08:00"
        payload2["finalized_at"] = "2026-11-10T02:26:01+08:00"
        for it in payload2["items"]:
            it["collected_at"] = "2026-11-10T02:26:00+08:00"
        payload2["by_person"]["wu"]["last_24h"] = 99
        (b / "items.json").write_text(
            json.dumps(payload2, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        (b / "manifest.json").write_text(
            json.dumps(
                {
                    "generated_at": payload2["generated_at"],
                    "files": {"items.json": {"sha256": "beef"}},
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        ha = hash_dir(a, volatile=volatile, sort_lists_by=None)
        hb = hash_dir(b, volatile=volatile, sort_lists_by=None)
        assert ha["files"]["items.json"]["raw_sha256"] != hb["files"]["items.json"]["raw_sha256"]
        assert (
            ha["files"]["items.json"]["content_sha256"]
            == hb["files"]["items.json"]["content_sha256"]
        )
        assert ha["combined_content_sha256"] == hb["combined_content_sha256"]
        # 實質變更：多一筆
        payload3 = json.loads(json.dumps(payload2))
        payload3["items"].append(
            {"url": "https://example.com/3", "title": "丙", "collected_at": "x"}
        )
        c = root / "c"
        c.mkdir()
        (c / "items.json").write_text(
            json.dumps(payload3, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        hc = hash_dir(c, volatile=volatile, sort_lists_by=None)
        assert hc["combined_content_sha256"] != ha["combined_content_sha256"]
    print("SELFTEST_OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Canonical content hash for hsinchu-watch JSON data dirs")
    ap.add_argument("dir", nargs="?", help="directory of *.json")
    ap.add_argument("--json", action="store_true", help="print full JSON report")
    ap.add_argument(
        "--compare",
        metavar="DIR_OR_HASHFILE",
        help="compare combined content hash; exit 0 same / 10 different",
    )
    ap.add_argument(
        "--volatile",
        default=",".join(sorted(DEFAULT_VOLATILE)),
        help="comma-separated volatile keys to strip",
    )
    ap.add_argument(
        "--sort-lists-by",
        default="auto",
        help="dict-list sort key; default auto = id, else url, else keep order",
    )
    ap.add_argument(
        "--include-manifest",
        action="store_true",
        help="include manifest.json in combined hash (default: skip)",
    )
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)

    if args.self_test:
        return self_test()
    if not args.dir:
        ap.error("dir required (or --self-test)")

    volatile = frozenset(k.strip() for k in args.volatile.split(",") if k.strip())
    try:
        report = hash_dir(
            Path(args.dir),
            volatile=volatile,
            sort_lists_by=args.sort_lists_by,
            include_manifest=args.include_manifest,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if args.compare:
        try:
            other = load_compare_target(
                args.compare, volatile=volatile, sort_lists_by=args.sort_lists_by
            )
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2
        same = report["combined_content_sha256"] == other.get("combined_content_sha256")
        if args.json:
            out = {
                "same": same,
                "left": report,
                "right_combined": other.get("combined_content_sha256"),
                "right_dir": other.get("dir"),
            }
            print(json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True))
        else:
            print(
                f"combined_content_sha256={report['combined_content_sha256']}"
                f" other={other.get('combined_content_sha256')} same={same}"
            )
        return 0 if same else 10

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(f"dir={report['dir']}")
        for name, info in report["files"].items():
            print(
                f"  {name} raw={info['raw_sha256'][:16]} content={info['content_sha256'][:16]}"
            )
        print(f"combined_content_sha256={report['combined_content_sha256']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
