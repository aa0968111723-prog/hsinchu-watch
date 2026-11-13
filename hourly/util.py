# -*- coding: utf-8 -*-
"""共用小工具（stdlib only）：canonical JSON、sha256、原子寫入、append-only JSONL、跨程序檔案鎖。"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Iterator

TAIPEI = timezone(timedelta(hours=8))


def now_iso() -> str:
    return datetime.now(TAIPEI).isoformat(timespec="seconds")


def canon(obj: Any) -> bytes:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_obj(obj: Any) -> str:
    return sha256_bytes(canon(obj))


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def atomic_write_bytes(path: Path, data: bytes, *, immutable: bool = False) -> bool:
    """原子寫入（tmp+fsync+rename）。immutable=True：檔已存在則不覆寫（內容須相同，否則 raise）。
    回傳 True=本次新建。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    if immutable and path.exists():
        if path.read_bytes() != data:
            raise FileExistsError(f"immutable file exists with different content: {path}")
        return False
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".part")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if immutable:
            try:
                os.link(tmp, path)  # 原子建立；已存在則 FileExistsError
            except FileExistsError:
                if path.read_bytes() != data:
                    raise
                return False
            finally:
                os.unlink(tmp)
            return True
        os.replace(tmp, path)
        return True
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def append_jsonl(path: Path, rows: Iterable[dict]) -> int:
    """append-only；一次寫完並 fsync。不提供改寫／刪除。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    buf = "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rows)
    if not buf:
        return 0
    with open(path, "ab") as f:
        f.write(buf.encode("utf-8"))
        f.flush()
        os.fsync(f.fileno())
    return buf.count("\n")


def read_jsonl(path: Path) -> Iterator[dict]:
    try:
        f = open(path, "r", encoding="utf-8")
    except FileNotFoundError:
        return
    with f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                # 尾端半行（崩潰中斷）略過，不改檔
                continue


class FileLock:
    """跨程序排他鎖（fcntl.flock）；用於 store 寫入序列化（非發布鎖）。"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self._fd = None

    def __enter__(self):
        import fcntl

        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fd = os.open(str(self.path), os.O_CREAT | os.O_RDWR, 0o644)
        fcntl.flock(self._fd, fcntl.LOCK_EX)
        return self

    def __exit__(self, *a):
        import fcntl

        try:
            fcntl.flock(self._fd, fcntl.LOCK_UN)
        finally:
            os.close(self._fd)
