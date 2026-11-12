#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""hsinchu-watch data/ 提交前守衛（stdlib only）。

在 Actions commit 前執行：解析 JSON、必填欄位（含 url）、筆數暴跌、
空檔覆寫非空、公開庫隱私掃描（留言者帳號／頭像鍵、摘錄 >30 字）、
過期／未更新／不完整蒐集。
失敗 exit 1；永不寫入 data/、永不刪檔。

用法：
  python3 guard_data.py [--data DIR] [--prev DIR] [--drop-threshold 0.5]
                        [--max-age-minutes 45] [--require-change]
                        [--mode default|publish|restore]
  # default／publish：發布目錄缺 official.json → incomplete FAIL
  # restore：snapshot 形 manifest 不當發布標記；若有 snapshot manifest 則核對 sha256
  # 若在 git 庫內且未給 --prev，會用 git show HEAD:data/<file> 當上一版
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

DEFAULT_DROP_THRESHOLD = 0.50
DEFAULT_MAX_AGE_MINUTES = 45
EXCERPT_MAX_CHARS = 30  # PROMPT：anonymous_excerpt 上限 30 字

# PROMPT「資料欄位」＋ schema 共核；url 為硬性必填
ITEM_REQUIRED = (
    "person",
    "platform",
    "source_name",
    "collected_at",
    "url",
    "title",
    "sentiment",
    "is_own_speech",
)

# 統計物件最低鍵（stats.json）
STATS_REQUIRED = ("generated_at", "timezone", "total_items", "by_person", "persons", "disclaimer")

# 民調：url 或 source_url 擇一；機構／期間／樣本為提示欄位
POLL_URL_KEYS = ("url", "source_url")
POLL_SOFT_KEYS = ("pollster", "org", "sample_size", "field_start", "field_end", "period")

# 隱私鍵：留言者帳號／名字／頭像／handle（大小寫不敏感）
PRIVACY_KEY_RE = re.compile(
    r"^(author|user|handle|account|username|profile|avatar|"
    r"author_name|user_name|user_id|account_name|screen_name|"
    r"display_name|profile_url|profile_image|profile_link|avatar_url)$",
    re.I,
)

EXCERPT_FIELD_NAMES = frozenset(
    {"anonymous_excerpt", "excerpt", "text"}  # text 僅在 excerpt 物件內檢查
)

EXPECTED_NAMES = frozenset(
    {
        "items.json",
        "stats.json",
        "items_zheng.json",
        "items_xu.json",
        "items_wu.json",
        "polls.json",
        "polls_verified.json",
        "excluded.json",
        "excluded_publish.json",
        "official.json",
        "manifest.json",
        "latest.json",
        "latest_24h.json",
        "policies.json",
        "keywords.json",
    }
)

# 蒐集端 data/ 最低必要檔
REQUIRED_COMPLETE_NAMES = ("items.json", "stats.json")
# 發布端 public/data（有 manifest／latest 時自動要求）
REQUIRED_PUBLISH_NAMES = ("official.json",)
# manifest.counts 新欄位（舊版可能只有 excluded）
MANIFEST_COUNT_KEYS_NEW = ("excluded_collect", "excluded_publish", "pending_review")
MANIFEST_COUNT_KEYS_OLD = ("excluded",)

# --mode：default（自動辨識）／publish（強制發布規則）／restore（還原驗證）
MODES = ("default", "publish", "restore")

TAIPEI = timezone(timedelta(hours=8))


class Finding:
    __slots__ = ("level", "file", "code", "msg")

    def __init__(self, level: str, file: str, code: str, msg: str) -> None:
        self.level = level  # FAIL / WARN / INFO
        self.file = file
        self.code = code
        self.msg = msg


def _script_dir() -> Path:
    return Path(__file__).resolve().parent


def _project_root() -> Path:
    return _script_dir().parents[1]


def default_data_dir() -> Path:
    return _project_root() / "data"


def is_http_url(v: Any) -> bool:
    return isinstance(v, str) and len(v) >= 8 and (
        v.startswith("http://") or v.startswith("https://")
    )


def char_len(s: str) -> int:
    """以 Unicode 字元數計（中文一字算一）。"""
    return len(s)


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _first_int(data: dict, keys: tuple[str, ...]) -> int | None:
    for k in keys:
        v = data.get(k)
        if isinstance(v, int) and v >= 0:
            return v
    return None


def count_excluded_hard(data: dict) -> int:
    """硬排除筆數：相容舊 count／新 excluded_collect／excluded 陣列。"""
    n = _first_int(data, ("count", "excluded_collect", "excluded_publish"))
    if n is not None:
        return n
    excl = data.get("excluded")
    if isinstance(excl, list):
        return len(excl)
    return 0


def count_pending_review(data: dict) -> int | None:
    """待審筆數：pending_review_count 或 pending_review 陣列；無欄位則 None。"""
    c = data.get("pending_review_count")
    if isinstance(c, int) and c >= 0:
        return c
    pr = data.get("pending_review")
    if isinstance(pr, int) and pr >= 0:
        return pr
    if isinstance(pr, list):
        return len(pr)
    if "pending_review_count" in data or "pending_review" in data:
        return 0
    return None


def count_official(data: dict) -> int:
    """official.json：加總 by_person.*.count 或 items 長度。"""
    bp = data.get("by_person")
    if not isinstance(bp, dict):
        # 舊／簡化：頂層 items 陣列
        items = data.get("items")
        if isinstance(items, list):
            return len(items)
        return 0
    total = 0
    for block in bp.values():
        if isinstance(block, dict):
            c = block.get("count")
            if isinstance(c, int) and c >= 0:
                total += c
                continue
            items = block.get("items")
            if isinstance(items, list):
                total += len(items)
        elif isinstance(block, list):
            total += len(block)
    return total


def count_items(data: Any, name: str) -> int | None:
    if isinstance(data, list):
        return len(data)
    if not isinstance(data, dict):
        return None
    if name == "stats.json":
        ti = data.get("total_items")
        if isinstance(ti, int) and ti >= 0:
            return ti
        return 1
    # excluded.json／excluded_publish.json：舊 count 或新 excluded_collect／陣列
    if name in ("excluded.json", "excluded_publish.json"):
        return count_excluded_hard(data)
    if name == "official.json":
        return count_official(data)
    if name == "polls_verified.json":
        polls = data.get("polls")
        if isinstance(polls, list):
            return len(polls)
        return 0
    if name == "manifest.json":
        counts = data.get("counts")
        if isinstance(counts, dict):
            # 以 items_rows 或 items_unique_url 當主筆數
            n = _first_int(counts, ("items_rows", "items_unique_url", "items"))
            if n is not None:
                return n
        return 1
    return 1


def is_empty_payload(raw: bytes, data: Any | None) -> bool:
    if len(raw.strip()) == 0:
        return True
    if data is None:
        return False
    if isinstance(data, list) and len(data) == 0:
        return True
    if isinstance(data, dict) and len(data) == 0:
        return True
    return False


def walk_privacy(obj: Any, path: str, findings: list[Finding], file: str) -> None:
    """遞迴掃隱私鍵與過長摘錄；不印出真實帳號或原文內容。"""
    if isinstance(obj, dict):
        for k, v in obj.items():
            key_path = f"{path}.{k}" if path else k
            if PRIVACY_KEY_RE.match(str(k)):
                findings.append(
                    Finding(
                        "FAIL",
                        file,
                        "privacy_key",
                        f"偵測到疑似留言者／帳號欄位鍵「{k}」（路徑 {key_path}）；公開庫禁止外露",
                    )
                )
            if str(k) in ("anonymous_excerpt", "excerpt") and isinstance(v, str) and v:
                n = char_len(v)
                if n > EXCERPT_MAX_CHARS:
                    findings.append(
                        Finding(
                            "FAIL",
                            file,
                            "excerpt_too_long",
                            f"摘錄欄位「{k}」長度 {n} 字 > {EXCERPT_MAX_CHARS}（路徑 {key_path}）；不印出原文",
                        )
                    )
            if str(k) == "text" and isinstance(v, str) and v:
                if "excerpt" in path.lower():
                    n = char_len(v)
                    if n > EXCERPT_MAX_CHARS:
                        findings.append(
                            Finding(
                                "FAIL",
                                file,
                                "excerpt_too_long",
                                f"摘錄 text 長度 {n} 字 > {EXCERPT_MAX_CHARS}（路徑 {key_path}）；不印出原文",
                            )
                        )
            walk_privacy(v, key_path, findings, file)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            walk_privacy(item, f"{path}[{i}]", findings, file)


def check_item_fields(item: Any, idx: int, file: str, findings: list[Finding]) -> None:
    if not isinstance(item, dict):
        findings.append(
            Finding("FAIL", file, "item_not_object", f"items[{idx}] 不是物件")
        )
        return
    for key in ITEM_REQUIRED:
        if key not in item or item[key] in (None, ""):
            findings.append(
                Finding(
                    "FAIL",
                    file,
                    "missing_field",
                    f"items[{idx}] 缺少必填欄位「{key}」",
                )
            )
    url = item.get("url")
    if "url" in item and url not in (None, "") and not is_http_url(url):
        findings.append(
            Finding(
                "FAIL",
                file,
                "bad_url",
                f"items[{idx}] 的 url 不是 http(s) 連結",
            )
        )


def check_poll_fields(item: Any, idx: int, file: str, findings: list[Finding]) -> None:
    if not isinstance(item, dict):
        findings.append(
            Finding("FAIL", file, "poll_not_object", f"polls[{idx}] 不是物件")
        )
        return
    has_url = any(is_http_url(item.get(k)) for k in POLL_URL_KEYS)
    if not has_url:
        if not any(item.get(k) for k in POLL_URL_KEYS):
            findings.append(
                Finding(
                    "FAIL",
                    file,
                    "missing_field",
                    f"polls[{idx}] 缺少 url／source_url",
                )
            )
        else:
            findings.append(
                Finding(
                    "FAIL",
                    file,
                    "bad_url",
                    f"polls[{idx}] 的 url／source_url 不是有效 http(s)",
                )
            )


def check_stats_fields(data: dict, file: str, findings: list[Finding]) -> None:
    for key in STATS_REQUIRED:
        if key not in data:
            findings.append(
                Finding(
                    "FAIL",
                    file,
                    "missing_field",
                    f"stats 缺少必填欄位「{key}」",
                )
            )


def check_official_fields(data: Any, file: str, findings: list[Finding]) -> None:
    """official.json：by_person.*.items 用與 items 相同必填欄位。"""
    if not isinstance(data, dict):
        findings.append(Finding("FAIL", file, "schema", "official.json 應為物件"))
        return
    if "by_person" not in data:
        findings.append(
            Finding("FAIL", file, "missing_field", "official.json 缺少 by_person")
        )
        return
    bp = data.get("by_person")
    if not isinstance(bp, dict):
        findings.append(
            Finding("FAIL", file, "schema", "official.json by_person 應為物件")
        )
        return
    for pid, block in bp.items():
        items: list | None = None
        if isinstance(block, dict):
            items = block.get("items") if isinstance(block.get("items"), list) else None
        elif isinstance(block, list):
            items = block
        else:
            findings.append(
                Finding(
                    "FAIL",
                    file,
                    "schema",
                    f"official.json by_person.{pid} 應為物件或陣列",
                )
            )
            continue
        if items is None:
            findings.append(
                Finding(
                    "FAIL",
                    file,
                    "missing_field",
                    f"official.json by_person.{pid} 缺少 items 陣列",
                )
            )
            continue
        for i, item in enumerate(items):
            check_item_fields(item, i, file, findings)
            walk_privacy(item, f"by_person.{pid}.items[{i}]", findings, file)


def check_manifest_counts(data: Any, file: str, findings: list[Finding]) -> None:
    """manifest.json counts：新欄位 excluded_collect／excluded_publish／pending_review；
    舊版僅 excluded 則 WARN（仍相容）。"""
    if not isinstance(data, dict):
        findings.append(Finding("FAIL", file, "schema", "manifest.json 應為物件"))
        return
    counts = data.get("counts")
    if not isinstance(counts, dict):
        findings.append(
            Finding("FAIL", file, "missing_field", "manifest.json 缺少 counts 物件")
        )
        return
    has_new = all(k in counts for k in MANIFEST_COUNT_KEYS_NEW)
    has_old = any(k in counts for k in MANIFEST_COUNT_KEYS_OLD)
    if not has_new and not has_old:
        findings.append(
            Finding(
                "FAIL",
                file,
                "missing_field",
                "manifest.counts 缺少 excluded_collect／excluded_publish／pending_review（或舊版 excluded）",
            )
        )
    elif not has_new and has_old:
        findings.append(
            Finding(
                "WARN",
                file,
                "manifest_counts_legacy",
                "manifest.counts 僅有舊欄 excluded；建議改用 excluded_collect／excluded_publish／pending_review",
            )
        )
    # files.official.json 應存在於 files 對照
    files = data.get("files")
    if isinstance(files, dict) and "official.json" not in files:
        findings.append(
            Finding(
                "WARN",
                file,
                "manifest_missing_official",
                "manifest.files 未列出 official.json",
            )
        )


def maybe_check_pending_drop(
    name: str,
    data: Any,
    prev_data: Any | None,
    findings: list[Finding],
    drop_threshold: float,
) -> None:
    """excluded.json 新欄位 pending_review 暴跌檢查（與硬排除分開）。"""
    if name != "excluded.json":
        return
    if not isinstance(data, dict) or not isinstance(prev_data, dict):
        return
    cur_n = count_pending_review(data)
    prev_n = count_pending_review(prev_data)
    if cur_n is None or prev_n is None:
        return
    if prev_n > 0 and cur_n < prev_n * (1.0 - drop_threshold):
        drop_pct = (1.0 - cur_n / prev_n) * 100.0
        findings.append(
            Finding(
                "FAIL",
                name,
                "count_drop",
                f"pending_review 筆數由 {prev_n} → {cur_n}"
                f"（下降 {drop_pct:.1f}% > 閾值 {drop_threshold*100:.0f}%）",
            )
        )


def load_prev_bytes(name: str, prev_dir: Path | None, use_git: bool, data_dir: Path) -> bytes | None:
    if prev_dir is not None:
        p = prev_dir / name
        if p.is_file():
            return p.read_bytes()
        return None
    if use_git:
        rel = f"data/{name}"
        try:
            r = subprocess.run(
                ["git", "show", f"HEAD:{rel}"],
                cwd=str(data_dir.parent),
                capture_output=True,
                check=False,
            )
            if r.returncode == 0:
                return r.stdout
        except FileNotFoundError:
            pass
    return None


def parse_generated_at(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TAIPEI)
    return dt


def newest_json_mtime(data_dir: Path) -> datetime | None:
    newest: float | None = None
    for p in data_dir.iterdir():
        if p.is_file() and p.suffix == ".json":
            m = p.stat().st_mtime
            if newest is None or m > newest:
                newest = m
    if newest is None:
        return None
    return datetime.fromtimestamp(newest, TAIPEI)


def guard_file(
    path: Path,
    prev_raw: bytes | None,
    findings: list[Finding],
    drop_threshold: float,
) -> None:
    name = path.name
    raw = path.read_bytes()
    data: Any | None = None
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        findings.append(
            Finding("FAIL", name, "json_parse", f"JSON 無法解析：{type(e).__name__}")
        )
        if prev_raw is not None and len(prev_raw.strip()) > 0 and len(raw.strip()) == 0:
            findings.append(
                Finding(
                    "FAIL",
                    name,
                    "empty_overwrite",
                    "空檔覆寫了上一版非空檔",
                )
            )
        return

    if prev_raw is not None:
        prev_data: Any | None = None
        try:
            prev_data = json.loads(prev_raw.decode("utf-8"))
        except Exception:
            prev_data = None
        prev_empty = is_empty_payload(prev_raw, prev_data)
        cur_empty = is_empty_payload(raw, data)
        if cur_empty and not prev_empty:
            findings.append(
                Finding(
                    "FAIL",
                    name,
                    "empty_overwrite",
                    "空內容覆寫了上一版非空內容",
                )
            )

        cur_n = count_items(data, name)
        prev_n = count_items(prev_data, name) if prev_data is not None else None
        if (
            cur_n is not None
            and prev_n is not None
            and prev_n > 0
            and cur_n < prev_n * (1.0 - drop_threshold)
        ):
            drop_pct = (1.0 - cur_n / prev_n) * 100.0
            findings.append(
                Finding(
                    "FAIL",
                    name,
                    "count_drop",
                    f"筆數由 {prev_n} → {cur_n}（下降 {drop_pct:.1f}% > 閾值 {drop_threshold*100:.0f}%）",
                )
            )
        maybe_check_pending_drop(name, data, prev_data, findings, drop_threshold)

    if name.startswith("items") and name.endswith(".json"):
        if not isinstance(data, list):
            findings.append(
                Finding("FAIL", name, "schema", "items 檔應為陣列")
            )
        else:
            for i, item in enumerate(data):
                check_item_fields(item, i, name, findings)
                walk_privacy(item, f"[{i}]", findings, name)
    elif name == "polls.json":
        if not isinstance(data, list):
            findings.append(
                Finding("FAIL", name, "schema", "polls.json 應為陣列")
            )
        else:
            for i, item in enumerate(data):
                check_poll_fields(item, i, name, findings)
                walk_privacy(item, f"[{i}]", findings, name)
    elif name == "stats.json":
        if not isinstance(data, dict):
            findings.append(
                Finding("FAIL", name, "schema", "stats.json 應為物件")
            )
        else:
            check_stats_fields(data, name, findings)
            walk_privacy(data, "", findings, name)
    elif name == "official.json":
        check_official_fields(data, name, findings)
    elif name == "manifest.json":
        if is_snapshot_manifest(data):
            # 快照清單：不做 publish counts 檢查；隱私仍掃
            walk_privacy(data, "", findings, name)
        else:
            check_manifest_counts(data, name, findings)
            walk_privacy(data, "", findings, name)
    elif name in ("excluded.json", "excluded_publish.json"):
        if not isinstance(data, dict):
            findings.append(
                Finding("FAIL", name, "schema", f"{name} 應為物件")
            )
        else:
            walk_privacy(data, "", findings, name)
    else:
        walk_privacy(data, "", findings, name)


def is_snapshot_manifest(data: Any) -> bool:
    """snapshot.py 產出的快照清單（非發布 manifest）。"""
    if not isinstance(data, dict):
        return False
    if data.get("kind") == "snapshot":
        return True
    if data.get("snapshot_id") and isinstance(data.get("files"), list):
        return True
    files = data.get("files")
    if isinstance(files, list) and files:
        # 典型：[{name, sha256, ...}, ...]
        f0 = files[0]
        if isinstance(f0, dict) and "sha256" in f0 and ("name" in f0 or "path" in f0):
            if "counts" not in data and "generated_at" not in data:
                return True
    return False


def is_publish_manifest(data: Any) -> bool:
    """finalize／public/data 的發布 manifest（有 counts 或 files 為物件對照）。"""
    if not isinstance(data, dict):
        return False
    if is_snapshot_manifest(data):
        return False
    if isinstance(data.get("counts"), dict):
        return True
    files = data.get("files")
    if isinstance(files, dict) and files:
        return True
    if "finalized_at" in data and "generated_at" in data:
        return True
    return False


def load_manifest_obj(data_dir: Path) -> Any | None:
    p = data_dir / "manifest.json"
    if not p.is_file():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def looks_like_publish_dir(
    data_dir: Path,
    names: set[str],
    mode: str = "default",
) -> bool:
    """辨識是否為發布端 public/data。

    - latest.json → 發布
    - manifest.json 若為 **snapshot 形** → 不視為發布（避免還原假陽性）
    - manifest.json 若為 **publish 形** → 發布
    - mode=publish → 有 manifest／latest 即視為發布（仍尊重 snapshot 形除外，
      以免誤把純快照當發布；缺 official 的真發布靠 publish 形／latest 觸發）
    - mode=restore → 僅 latest 或 publish 形 manifest 才當發布
    """
    if "latest.json" in names:
        return True
    if "manifest.json" not in names:
        return False
    man = load_manifest_obj(data_dir)
    if man is None:
        # 無法解析：保守——default／publish 當發布；restore 不當
        return mode != "restore"
    if is_snapshot_manifest(man):
        return False
    if is_publish_manifest(man):
        return True
    # 未知形狀
    if mode == "restore":
        return False
    if mode == "publish":
        return True
    return False


def verify_snapshot_manifest_hashes(
    data_dir: Path,
    man: dict,
    findings: list[Finding],
) -> None:
    """還原模式：依 snapshot manifest 逐檔核對 sha256；不符 → FAIL。"""
    entries = man.get("files") or []
    if not isinstance(entries, list):
        findings.append(
            Finding("FAIL", "manifest.json", "schema", "snapshot manifest.files 應為陣列")
        )
        return
    for e in entries:
        if not isinstance(e, dict):
            continue
        name = e.get("name") or e.get("path")
        expect = e.get("sha256")
        if not name or not expect:
            continue
        # 僅比對完整 64 hex；短碼略過並 INFO
        if not (isinstance(expect, str) and len(expect) >= 64):
            findings.append(
                Finding(
                    "INFO",
                    "manifest.json",
                    "short_hash_skipped",
                    f"{name} 的 sha256 非完整 64 hex，還原核對略過",
                )
            )
            continue
        rel = Path(str(name)).name if "/" in str(name) else str(name)
        path = data_dir / rel
        if not path.is_file():
            path = data_dir / str(name)
        if not path.is_file():
            findings.append(
                Finding("FAIL", str(name), "hash_missing", f"snapshot 清單有 {name} 但目錄無此檔")
            )
            continue
        got = sha256_bytes(path.read_bytes())
        if got != expect:
            findings.append(
                Finding(
                    "FAIL",
                    path.name,
                    "hash_mismatch",
                    f"與 snapshot manifest 不符：expected {expect[:16]}… got {got[:16]}…",
                )
            )


def check_incomplete(
    data_dir: Path,
    json_files: list[Path],
    findings: list[Finding],
    mode: str = "default",
) -> None:
    if not data_dir.is_dir():
        findings.append(
            Finding("FAIL", "data/", "incomplete", f"data_dir 不存在：{data_dir}")
        )
        return
    if not json_files:
        findings.append(
            Finding("FAIL", "data/", "incomplete", "data/ 沒有任何 JSON（蒐集未完成或不完整）")
        )
        return
    names = {p.name for p in json_files}
    for req in REQUIRED_COMPLETE_NAMES:
        if req not in names:
            findings.append(
                Finding(
                    "FAIL",
                    req,
                    "incomplete",
                    f"缺少必要檔案 {req}（蒐集未完成／不完整）",
                )
            )
    # 發布端必含 official.json；snapshot 形 manifest 不當發布標記
    publish = looks_like_publish_dir(data_dir, names, mode=mode)
    if mode == "publish":
        # 強制發布規則：只要目錄被辨為發布，或呼叫端明確 publish 且有 latest／publish-manifest
        publish = publish or ("latest.json" in names) or (
            "manifest.json" in names and is_publish_manifest(load_manifest_obj(data_dir) or {})
        )
        # 明確 --mode publish 時：有 official 需求的情境含「像 public 的檔名組合」
        if not publish and ("latest.json" in names or "official.json" in names):
            publish = True
        # 若使用者對一個缺 official 的真 public 目錄跑 publish：即使只有 items+stats+manifest(publish)
        if not publish and "manifest.json" in names:
            man = load_manifest_obj(data_dir)
            if man is not None and not is_snapshot_manifest(man):
                publish = True
    if publish:
        for req in REQUIRED_PUBLISH_NAMES:
            if req not in names:
                findings.append(
                    Finding(
                        "FAIL",
                        req,
                        "incomplete",
                        f"發布目錄缺少必要檔案 {req}（manifest 改版後 official.json 為必填）",
                    )
                )
    elif "official.json" not in names:
        findings.append(
            Finding(
                "INFO",
                "official.json",
                "expected_publish_only",
                "蒐集端／快照還原目錄無 official.json（由 finalize 寫入 public/data）；"
                "發布守衛請對 public/data 執行或 --mode publish",
            )
        )


def check_stale(
    data_dir: Path,
    json_files: list[Path],
    max_age_minutes: int | None,
    findings: list[Finding],
) -> None:
    if max_age_minutes is None or max_age_minutes <= 0:
        return
    now = datetime.now(TAIPEI)
    ref: datetime | None = None
    source = ""
    stats_path = data_dir / "stats.json"
    if stats_path.is_file():
        try:
            stats = json.loads(stats_path.read_text(encoding="utf-8"))
            if isinstance(stats, dict):
                ref = parse_generated_at(stats.get("generated_at"))
                if ref is not None:
                    source = "stats.json generated_at"
        except Exception:
            ref = None
    if ref is None:
        ref = newest_json_mtime(data_dir)
        if ref is not None:
            source = "newest json mtime"
    if ref is None:
        return  # incomplete 已另報
    age_min = (now - ref.astimezone(TAIPEI)).total_seconds() / 60.0
    if age_min > float(max_age_minutes):
        findings.append(
            Finding(
                "FAIL",
                "stats.json" if source.startswith("stats") else "data/",
                "stale_data",
                f"資料過期：{source}={ref.astimezone(TAIPEI).isoformat()}，"
                f"年齡 {age_min:.1f} 分 > 上限 {max_age_minutes} 分（不部署）",
            )
        )


def check_no_update(
    data_dir: Path,
    json_files: list[Path],
    prev_dir: Path | None,
    use_git: bool,
    require_change: bool,
    findings: list[Finding],
) -> None:
    if prev_dir is None and not use_git:
        return
    if not json_files:
        return
    compared = 0
    for path in json_files:
        prev_raw = load_prev_bytes(path.name, prev_dir, use_git, data_dir)
        if prev_raw is None:
            # 有新檔或無上一版 → 不算「完全未更新」
            return
        cur_raw = path.read_bytes()
        if sha256_bytes(cur_raw) != sha256_bytes(prev_raw):
            return
        compared += 1
    if compared == 0:
        return
    level = "FAIL" if require_change else "INFO"
    findings.append(
        Finding(
            level,
            "data/",
            "no_update",
            f"與上一版逐檔 sha256 完全相同（比對 {compared} 檔）；"
            + ("已開 --require-change，判定不部署" if require_change else "未開 --require-change，僅提示"),
        )
    )


def run_guard(
    data_dir: Path,
    prev_dir: Path | None,
    drop_threshold: float,
    max_age_minutes: int | None = DEFAULT_MAX_AGE_MINUTES,
    require_change: bool = False,
    mode: str = "default",
) -> int:
    if mode not in MODES:
        print(f"FAIL  unknown mode: {mode}")
        return 1
    findings: list[Finding] = []
    if not data_dir.is_dir():
        findings.append(
            Finding("FAIL", "data/", "incomplete", f"data_dir 不存在：{data_dir}")
        )
        for f in findings:
            print(f"{f.level}  [{f.file}] {f.code}: {f.msg}")
        print("RESULT  FAIL  files=0 findings=1 fails=1")
        return 1

    use_git = prev_dir is None and (data_dir.parent / ".git").exists()
    json_files = sorted(p for p in data_dir.iterdir() if p.is_file() and p.suffix == ".json")

    check_incomplete(data_dir, json_files, findings, mode=mode)

    # 結構／暴跌／隱私（僅在有檔時）
    for path in json_files:
        prev_raw = load_prev_bytes(path.name, prev_dir, use_git, data_dir)
        guard_file(path, prev_raw, findings, drop_threshold)

    # restore：若有 snapshot 形 manifest，核對 sha256
    if mode == "restore":
        man = load_manifest_obj(data_dir)
        if isinstance(man, dict) and is_snapshot_manifest(man):
            verify_snapshot_manifest_hashes(data_dir, man, findings)

    # restore 預設不做過期檢查（歷史快照會誤傷）；呼叫端可顯式傳 max_age>0
    if mode == "restore" and max_age_minutes == DEFAULT_MAX_AGE_MINUTES:
        max_age_minutes = None
    check_stale(data_dir, json_files, max_age_minutes, findings)
    check_no_update(data_dir, json_files, prev_dir, use_git, require_change, findings)

    fails = [f for f in findings if f.level == "FAIL"]
    for f in findings:
        print(f"{f.level}  [{f.file}] {f.code}: {f.msg}")

    print(
        f"RESULT  {'FAIL' if fails else 'PASS'}  "
        f"files={len(json_files)} findings={len(findings)} fails={len(fails)} "
        f"drop_threshold={drop_threshold} max_age_minutes={max_age_minutes} "
        f"require_change={require_change} mode={mode} "
        f"prev={'dir' if prev_dir else ('git' if use_git else 'none')}"
    )
    return 1 if fails else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="hsinchu-watch data/ 提交前守衛")
    ap.add_argument(
        "--data",
        type=Path,
        default=None,
        help="data/ 目錄（預設專案 data/）",
    )
    ap.add_argument(
        "--prev",
        type=Path,
        default=None,
        help="上一版 JSON 目錄（測試用；未給則試 git show HEAD:data/）",
    )
    ap.add_argument(
        "--drop-threshold",
        type=float,
        default=DEFAULT_DROP_THRESHOLD,
        help="筆數下降比例閾值（預設 0.5 = 50%%）",
    )
    ap.add_argument(
        "--max-age-minutes",
        type=int,
        default=DEFAULT_MAX_AGE_MINUTES,
        help="stats generated_at／最新 mtime 超過此分鐘數則 stale_data（預設 45；0=停用）",
    )
    ap.add_argument(
        "--require-change",
        action="store_true",
        help="與 --prev 完全相同時以 no_update 失敗（不部署）",
    )
    ap.add_argument(
        "--mode",
        choices=MODES,
        default="default",
        help="default=自動辨識；publish=發布規則（缺 official→FAIL）；"
        "restore=還原驗證（snapshot manifest 不當發布標記，並核對 sha256）",
    )
    args = ap.parse_args(argv)
    data_dir = (args.data or default_data_dir()).resolve()
    prev_dir = args.prev.resolve() if args.prev else None
    if prev_dir is not None and not prev_dir.is_dir():
        print(f"FAIL  --prev 不是目錄：{prev_dir}")
        return 1
    max_age = None if args.max_age_minutes <= 0 else args.max_age_minutes
    return run_guard(
        data_dir,
        prev_dir,
        args.drop_threshold,
        max_age_minutes=max_age,
        require_change=bool(args.require_change),
        mode=str(args.mode),
    )


if __name__ == "__main__":
    sys.exit(main())
