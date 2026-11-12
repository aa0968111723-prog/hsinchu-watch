#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""hsinchu-watch data/ JSON 只增不刪快照工具（stdlib only）。

預設輸出根目錄：本腳本所在資料夾（work/DB備份監控員/）。
永不寫入 data/、永不刪除任何檔案。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

UTC = timezone.utc
DEFAULT_WARN_FREE_BYTES = 8 * 1024 * 1024 * 1024  # 8 GiB
SNAPSHOTS_DIRNAME = "snapshots"
LATEST_POINTER = "LATEST.json"
MANIFEST_NAME = "manifest.json"

# 預期 data/ 檔名（依 collectors/run_all.py；實際以掃描為準）
EXPECTED_FILES = (
    "items.json",
    "stats.json",
    "items_zheng.json",
    "items_xu.json",
    "items_wu.json",
    "polls.json",
    "polls_verified.json",
    "excluded.json",
    "excluded_publish.json",
    # official.json／manifest.json／latest.json 由 finalize 寫入 public/data；
    # snapshot 以實際掃描為準，下列僅文件／缺檔提示用
    "official.json",
    "manifest.json",
    "latest.json",
)


def _script_dir() -> Path:
    return Path(__file__).resolve().parent


def _project_root() -> Path:
    # .../hsinchu-watch/work/DB備份監控員 -> hsinchu-watch
    return _script_dir().parents[1]


def default_data_dir() -> Path:
    return _project_root() / "data"


def default_out_root() -> Path:
    return _script_dir()


def utc_ts() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def free_bytes(path: Path) -> int:
    st = os.statvfs(str(path if path.exists() else path.parent))
    return int(st.f_bavail * st.f_frsize)


def atomic_write_bytes(dest: Path, data: bytes) -> None:
    """寫暫存檔後 os.replace；目標已存在則加碰撞後綴，永不覆寫。"""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    final = dest
    if final.exists():
        n = 1
        while True:
            cand = final.with_name(f"{final.stem}_{n}{final.suffix}")
            if not cand.exists():
                final = cand
                break
            n += 1
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{final.name}.",
        suffix=".tmp",
        dir=str(final.parent),
    )
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(str(tmp), str(final))
    except Exception:
        if tmp.exists():
            # 失敗時只留暫存不硬刪主檔；暫存可改名保留供排查
            failed = tmp.with_name(tmp.name + ".failed")
            try:
                os.replace(str(tmp), str(failed))
            except Exception:
                pass
        raise
    return final  # type: ignore[return-value]


def atomic_write_json(dest: Path, obj: Any) -> Path:
    raw = json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8")
    # 先驗證可 parse
    json.loads(raw.decode("utf-8"))
    written = atomic_write_bytes(dest, raw)
    # 寫後驗證
    text = Path(written).read_text(encoding="utf-8")
    json.loads(text)
    got = sha256_file(Path(written))
    expect = hashlib.sha256(raw).hexdigest()
    if got != expect:
        raise RuntimeError(f"hash mismatch after write: {written}")
    return Path(written)


def list_json_files(data_dir: Path) -> list[Path]:
    if not data_dir.exists():
        return []
    return sorted(p for p in data_dir.iterdir() if p.is_file() and p.suffix == ".json")


def schema_keys_of(path: Path) -> list[str]:
    """只回傳頂層／陣列元素的鍵名，不複製內容。"""
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
    except Exception as ex:
        return [f"<parse_error:{ex.__class__.__name__}>"]
    if isinstance(obj, dict):
        return sorted(obj.keys())
    if isinstance(obj, list):
        keys: set[str] = set()
        for item in obj[:50]:
            if isinstance(item, dict):
                keys.update(item.keys())
        return sorted(keys) if keys else ["<empty_array>"]
    return [f"<type:{type(obj).__name__}>"]


def inventory(data_dir: Path) -> list[dict[str, Any]]:
    rows = []
    for p in list_json_files(data_dir):
        st = p.stat()
        rows.append(
            {
                "name": p.name,
                "size": st.st_size,
                "mtime_utc": datetime.fromtimestamp(st.st_mtime, UTC).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                ),
                "sha256": sha256_file(p),
                "schema_keys": schema_keys_of(p),
            }
        )
    return rows


def _read_pointer_payload(out_root: Path) -> dict[str, Any] | None:
    """優先讀 LATEST_chain 最後一筆，其次 LATEST_current_*，再 LATEST.json。"""
    chain = out_root / "LATEST_chain.jsonl"
    if chain.exists():
        last = None
        for line in chain.read_text(encoding="utf-8").splitlines():
            if line.strip():
                try:
                    last = json.loads(line)
                except Exception:
                    continue
        if last and last.get("path"):
            ptr = out_root / last["path"]
            if ptr.exists():
                return json.loads(ptr.read_text(encoding="utf-8"))
    currents = sorted(out_root.glob("LATEST_current_*.json"), key=lambda x: x.name)
    if currents:
        return json.loads(currents[-1].read_text(encoding="utf-8"))
    ptr = out_root / LATEST_POINTER
    if ptr.exists():
        return json.loads(ptr.read_text(encoding="utf-8"))
    return None


def load_latest_manifest(out_root: Path) -> dict[str, Any] | None:
    try:
        info = _read_pointer_payload(out_root)
        if info:
            man_rel = info.get("manifest")
            if man_rel:
                man_path = out_root / man_rel
                if man_path.exists():
                    return json.loads(man_path.read_text(encoding="utf-8"))
            sid = info.get("snapshot_id")
            if sid:
                man_path = out_root / SNAPSHOTS_DIRNAME / sid / MANIFEST_NAME
                if man_path.exists():
                    return json.loads(man_path.read_text(encoding="utf-8"))
    except Exception:
        pass
    snaps = out_root / SNAPSHOTS_DIRNAME
    if not snaps.exists():
        return None
    dirs = sorted((d for d in snaps.iterdir() if d.is_dir()), key=lambda d: d.name)
    for d in reversed(dirs):
        man = d / MANIFEST_NAME
        if man.exists():
            return json.loads(man.read_text(encoding="utf-8"))
    return None


def content_fingerprint(files: list[dict[str, Any]]) -> str:
    h = hashlib.sha256()
    for f in sorted(files, key=lambda x: x["name"]):
        h.update(f["name"].encode())
        h.update(b":")
        h.update(f["sha256"].encode())
        h.update(b";")
    return h.hexdigest()


def unique_snap_dir(snapshots_root: Path, base_ts: str) -> Path:
    cand = snapshots_root / base_ts
    if not cand.exists():
        return cand
    n = 1
    while True:
        alt = snapshots_root / f"{base_ts}_{n}"
        if not alt.exists():
            return alt
        n += 1


def hardlink_or_copy(src: Path, dest: Path) -> str:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        n = 1
        while True:
            alt = dest.with_name(f"{dest.stem}_{n}{dest.suffix}")
            if not alt.exists():
                dest = alt
                break
            n += 1
    try:
        os.link(str(src), str(dest))
        return "hardlink"
    except OSError:
        # 跨裝置或不支援硬連結 → 複製（仍只增）
        tmp = dest.with_name(f".{dest.name}.tmp")
        shutil.copy2(src, tmp)
        os.replace(str(tmp), str(dest))
        return "copy"


def cmd_inventory(args: argparse.Namespace) -> int:
    rows = inventory(Path(args.data_dir))
    print(json.dumps({"data_dir": str(args.data_dir), "files": rows}, ensure_ascii=False, indent=2))
    return 0


def cmd_snapshot(args: argparse.Namespace) -> int:
    data_dir = Path(args.data_dir)
    out_root = Path(args.out_root)
    warn_free = int(args.warn_free_bytes)
    dry = bool(args.dry_run)

    if data_dir.resolve() == out_root.resolve() or out_root.resolve().is_relative_to(
        data_dir.resolve()
    ) if hasattr(Path, "is_relative_to") else str(out_root.resolve()).startswith(
        str(data_dir.resolve()) + os.sep
    ):
        # 額外防護：輸出根不可落在 data/ 內
        print("ERROR: out_root must not be inside data/", file=sys.stderr)
        return 2

    avail = free_bytes(out_root if out_root.exists() else out_root.parent)
    warn = avail < warn_free
    if warn:
        print(
            f"WARNING: free disk {avail} bytes < threshold {warn_free} bytes "
            f"({avail / (1024**3):.2f} GiB left)",
            file=sys.stderr,
        )

    files = inventory(data_dir)
    fp = content_fingerprint(files) if files else hashlib.sha256(b"empty").hexdigest()
    prev = load_latest_manifest(out_root)
    force = bool(getattr(args, "force", False))
    deduped = bool(prev and prev.get("content_fingerprint") == fp and files and not force)

    ts = utc_ts()
    plan = {
        "action": "dedupe_skip" if deduped else ("create_snapshot_force" if force else "create_snapshot"),
        "ts_utc": ts,
        "data_dir": str(data_dir),
        "out_root": str(out_root),
        "file_count": len(files),
        "content_fingerprint": fp,
        "disk_free_bytes": avail,
        "disk_warn": warn,
        "dry_run": dry,
        "files": [
            {"name": f["name"], "size": f["size"], "sha256": f["sha256"]} for f in files
        ],
    }

    if dry:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0

    snapshots_root = out_root / SNAPSHOTS_DIRNAME
    snapshots_root.mkdir(parents=True, exist_ok=True)

    if deduped:
        # 只增：寫一筆 dedupe 記錄，不複製內容、不刪舊快照
        note = {
            "kind": "dedupe",
            "ts_utc": ts,
            "ref_snapshot": prev.get("snapshot_id"),
            "content_fingerprint": fp,
            "file_count": len(files),
            "disk_free_bytes": avail,
            "disk_warn": warn,
        }
        note_path = snapshots_root / f"dedupe_{ts}.json"
        written = atomic_write_json(note_path, note)
        # 更新 LATEST 仍指向原快照（若指標已存在則寫碰撞後綴副本，另寫新指標）
        ptr_payload = {
            "snapshot_id": prev.get("snapshot_id"),
            "manifest": prev.get("manifest_rel")
            or f"{SNAPSHOTS_DIRNAME}/{prev.get('snapshot_id')}/{MANIFEST_NAME}",
            "content_fingerprint": fp,
            "updated_at_utc": ts,
            "last_dedupe_note": str(written.relative_to(out_root)),
        }
        # LATEST.json 若存在，改寫為 LATEST_<ts>.json 再寫新指標（只增：保留舊指標）
        ptr = out_root / LATEST_POINTER
        if ptr.exists():
            archive = out_root / f"LATEST_{ts}.json"
            # 複製舊指標到歸檔名（不刪原檔，接著用 replace 換新內容前先歸檔）
            hardlink_or_copy(ptr, archive)
            # 不能刪原檔；用原子寫到暫名再 replace 會覆寫——政策禁止覆寫。
            # 改為：寫 LATEST_current_<ts>.json，並寫 pointer_chain 追加。
            new_ptr = out_root / f"LATEST_current_{ts}.json"
            written_ptr = atomic_write_json(new_ptr, ptr_payload)
            chain_path = out_root / "LATEST_chain.jsonl"
            line = json.dumps(
                {"ts_utc": ts, "path": str(written_ptr.relative_to(out_root))},
                ensure_ascii=False,
            )
            with chain_path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")
                f.flush()
                os.fsync(f.fileno())
        else:
            atomic_write_json(ptr, ptr_payload)
        plan["action"] = "dedupe_recorded"
        plan["dedupe_note"] = str(written)
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0

    snap_dir = unique_snap_dir(snapshots_root, ts)
    snap_dir.mkdir(parents=True, exist_ok=False)
    stored = []
    for f in files:
        src = data_dir / f["name"]
        dest = snap_dir / f["name"]
        # 若與上一快照同 hash，嘗試硬連結上一份以省空間
        method = "copy"
        linked = False
        if prev:
            for pf in prev.get("files") or []:
                if pf.get("name") == f["name"] and pf.get("sha256") == f["sha256"]:
                    prev_path = out_root / prev["snapshot_rel"] / f["name"]
                    if prev_path.exists():
                        method = hardlink_or_copy(prev_path, dest)
                        linked = True
                    break
        if not linked:
            method = hardlink_or_copy(src, dest)
        # 驗證
        got = sha256_file(dest)
        if got != f["sha256"]:
            raise RuntimeError(f"snapshot hash mismatch for {f['name']}")
        try:
            json.loads(dest.read_text(encoding="utf-8"))
        except Exception as ex:
            raise RuntimeError(f"snapshot JSON invalid for {f['name']}: {ex}") from ex
        stored.append(
            {
                "name": f["name"],
                "size": f["size"],
                "sha256": f["sha256"],
                "schema_keys": f["schema_keys"],
                "store_method": method,
            }
        )

    manifest = {
        "kind": "snapshot",
        "snapshot_id": snap_dir.name,
        "ts_utc": ts,
        "data_dir": str(data_dir.resolve()),
        "snapshot_rel": f"{SNAPSHOTS_DIRNAME}/{snap_dir.name}",
        "manifest_rel": f"{SNAPSHOTS_DIRNAME}/{snap_dir.name}/{MANIFEST_NAME}",
        "content_fingerprint": fp,
        "file_count": len(stored),
        "files": stored,
        "disk_free_bytes": avail,
        "disk_warn": warn,
        "forced": force,
        "policy": {
            "append_only": True,
            "never_delete": True,
            "never_write_data_dir": True,
        },
    }
    man_path = atomic_write_json(snap_dir / MANIFEST_NAME, manifest)

    ptr_payload = {
        "snapshot_id": snap_dir.name,
        "manifest": str(man_path.relative_to(out_root)),
        "content_fingerprint": fp,
        "updated_at_utc": ts,
    }
    ptr = out_root / LATEST_POINTER
    if ptr.exists():
        archive = out_root / f"LATEST_{ts}.json"
        hardlink_or_copy(ptr, archive)
        new_ptr = out_root / f"LATEST_current_{ts}.json"
        written_ptr = atomic_write_json(new_ptr, ptr_payload)
        chain_path = out_root / "LATEST_chain.jsonl"
        with chain_path.open("a", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {"ts_utc": ts, "path": str(written_ptr.relative_to(out_root))},
                    ensure_ascii=False,
                )
                + "\n"
            )
            f.flush()
            os.fsync(f.fileno())
        # 也寫一份可讀的 CURRENT.txt（只增碰撞）
        atomic_write_bytes(
            out_root / "CURRENT_SNAPSHOT.txt",
            f"{snap_dir.name}\n".encode("utf-8"),
        )
    else:
        atomic_write_json(ptr, ptr_payload)
        atomic_write_bytes(
            out_root / "CURRENT_SNAPSHOT.txt",
            f"{snap_dir.name}\n".encode("utf-8"),
        )

    plan["action"] = "created"
    plan["snapshot_id"] = snap_dir.name
    plan["manifest"] = str(man_path)
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    return 0


def resolve_snapshot(out_root: Path, snapshot_id: str | None) -> Path:
    if snapshot_id:
        d = out_root / SNAPSHOTS_DIRNAME / snapshot_id
        if not d.is_dir():
            raise FileNotFoundError(f"snapshot not found: {snapshot_id}")
        return d
    # prefer LATEST_chain last, else LATEST.json, else newest dir
    chain = out_root / "LATEST_chain.jsonl"
    if chain.exists():
        last = None
        for line in chain.read_text(encoding="utf-8").splitlines():
            if line.strip():
                last = json.loads(line)
        if last:
            ptr = out_root / last["path"]
            info = json.loads(ptr.read_text(encoding="utf-8"))
            return out_root / SNAPSHOTS_DIRNAME / info["snapshot_id"]
    ptr = out_root / LATEST_POINTER
    if ptr.exists():
        info = json.loads(ptr.read_text(encoding="utf-8"))
        return out_root / SNAPSHOTS_DIRNAME / info["snapshot_id"]
    snaps = out_root / SNAPSHOTS_DIRNAME
    dirs = sorted((d for d in snaps.iterdir() if d.is_dir()), key=lambda d: d.name)
    if not dirs:
        raise FileNotFoundError("no snapshots")
    return dirs[-1]


def cmd_verify(args: argparse.Namespace) -> int:
    out_root = Path(args.out_root)
    snap = resolve_snapshot(out_root, args.snapshot)
    man_path = snap / MANIFEST_NAME
    if not man_path.exists():
        print(json.dumps({"ok": False, "error": "missing manifest"}, ensure_ascii=False))
        return 1
    man = json.loads(man_path.read_text(encoding="utf-8"))
    problems = []
    for f in man.get("files") or []:
        p = snap / f["name"]
        if not p.exists():
            problems.append({"name": f["name"], "error": "missing"})
            continue
        got = sha256_file(p)
        if got != f["sha256"]:
            problems.append(
                {"name": f["name"], "error": "hash_mismatch", "expected": f["sha256"], "got": got}
            )
            continue
        try:
            json.loads(p.read_text(encoding="utf-8"))
        except Exception as ex:
            problems.append({"name": f["name"], "error": f"json:{ex.__class__.__name__}"})
    result = {
        "ok": not problems,
        "snapshot_id": snap.name,
        "checked": len(man.get("files") or []),
        "problems": problems,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


def cmd_restore(args: argparse.Namespace) -> int:
    """還原到指定目錄（預設 out_root/restore_staging/），不寫入 data/。

    流程：先在 staging 旁寫 pre_restore_<ts>/ 副本，再寫入目標檔。
    """
    out_root = Path(args.out_root)
    snap = resolve_snapshot(out_root, args.snapshot)
    target = Path(args.target) if args.target else (out_root / "restore_staging")
    data_dir = Path(args.data_dir).resolve()
    if target.resolve() == data_dir or str(target.resolve()).startswith(str(data_dir) + os.sep):
        print("ERROR: refuse to restore into data/; pick another --target", file=sys.stderr)
        return 2
    dry = bool(args.dry_run)
    ts = utc_ts()
    man = json.loads((snap / MANIFEST_NAME).read_text(encoding="utf-8"))
    pre = target.parent / f"pre_restore_{ts}"
    plan = {
        "action": "restore",
        "snapshot_id": snap.name,
        "target": str(target),
        "pre_restore": str(pre),
        "files": [f["name"] for f in man.get("files") or []],
        "dry_run": dry,
    }
    if dry:
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0

    pre.mkdir(parents=True, exist_ok=False)
    target.mkdir(parents=True, exist_ok=True)
    # 先把目標現有 json 複製到 pre_restore（只增）
    if target.exists():
        for p in sorted(target.glob("*.json")):
            hardlink_or_copy(p, pre / p.name)
    restored = []
    for f in man.get("files") or []:
        src = snap / f["name"]
        dest = target / f["name"]
        if dest.exists():
            # 不覆寫：寫成 name_restored_<ts>.json 或碰撞後綴
            dest = target / f"{Path(f['name']).stem}_restored_{ts}.json"
        method = hardlink_or_copy(src, dest)
        got = sha256_file(dest)
        if got != f["sha256"]:
            raise RuntimeError(f"restore hash mismatch: {f['name']}")
        json.loads(dest.read_text(encoding="utf-8"))
        restored.append({"name": f["name"], "dest": dest.name, "method": method, "sha256": got})
    # 寫還原報告
    report = {
        "ts_utc": ts,
        "snapshot_id": snap.name,
        "target": str(target),
        "pre_restore": str(pre),
        "restored": restored,
        "checklist": {
            "pre_restore_saved": True,
            "hashes_match": True,
            "json_parse_ok": True,
            "wrote_into_data_dir": False,
            "deleted_anything": False,
        },
    }
    report_path = atomic_write_json(out_root / f"restore_report_{ts}.json", report)
    plan["report"] = str(report_path)
    plan["restored"] = restored
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="hsinchu-watch data/ append-only snapshot tool")
    p.add_argument(
        "--data-dir",
        default=str(default_data_dir()),
        help="source data directory (read-only)",
    )
    p.add_argument(
        "--out-root",
        default=str(default_out_root()),
        help="snapshot output root (default: this work folder)",
    )
    p.add_argument(
        "--warn-free-bytes",
        type=int,
        default=DEFAULT_WARN_FREE_BYTES,
        help="disk free-space warning threshold in bytes",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    s_inv = sub.add_parser("inventory", help="list data/ JSON metadata only")
    s_inv.set_defaults(func=cmd_inventory)

    s_snap = sub.add_parser("snapshot", help="take append-only snapshot")
    s_snap.add_argument("--dry-run", action="store_true")
    s_snap.add_argument(
        "--force",
        action="store_true",
        help="即使內容指紋相同也建立新時間戳快照目錄（硬連結／複製，永不刪舊）",
    )
    s_snap.set_defaults(func=cmd_snapshot)

    s_ver = sub.add_parser("verify", help="verify a snapshot against its manifest")
    s_ver.add_argument("--snapshot", default=None, help="snapshot id (default: latest)")
    s_ver.set_defaults(func=cmd_verify)

    s_res = sub.add_parser(
        "restore",
        help="restore into staging dir (never into data/); keeps pre-restore copy",
    )
    s_res.add_argument("--snapshot", default=None)
    s_res.add_argument(
        "--target",
        default=None,
        help="restore target directory (default: <out-root>/restore_staging)",
    )
    s_res.add_argument("--dry-run", action="store_true")
    s_res.set_defaults(func=cmd_restore)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
