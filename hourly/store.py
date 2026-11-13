# -*- coding: utf-8 -*-
"""不可變批次 store（append-only）。

hourly_store/
  objects/<aa>/<sha>.json     item 內容版本（內容定址，永不覆寫）
  batches/<batch_id>.json     不可變批次 manifest（只含 delta，不整份覆寫快照）
  events.jsonl                持久化事件序號（seq 單調遞增，append-only）
  corrections.jsonl           更正歷史（append-only；較新更正不被舊批次覆蓋）
  exclusions.jsonl            排除清單歷史（append-only）
  health.jsonl                每次匯入／來源健康紀錄（成功與失敗）
  HEAD                        最後成功批次 id（原子更新）
  checkpoints/<agent>.json    各代理獨立 checkpoint
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

from .util import (FileLock, append_jsonl, atomic_write_bytes, canon, now_iso, read_json, read_jsonl,
                   sha256_bytes)

AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,39}$")
DEFAULT_AGENTS = ("line1", "line2", "line3", "line4", "line5")  # 五條代理；line4＝整合發布線


class StoreError(Exception):
    pass


class Store:
    def __init__(self, root: Path | str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = FileLock(self.root / ".store.lock")

    # ---- paths
    def p(self, *a: str) -> Path:
        return self.root.joinpath(*a)

    # ---- objects
    def put_object(self, obj: dict) -> str:
        data = canon(obj)
        h = sha256_bytes(data)
        atomic_write_bytes(self.p("objects", h[:2], h + ".json"), data, immutable=True)
        return h

    def get_object(self, h: str) -> Optional[dict]:
        if not re.fullmatch(r"[0-9a-f]{64}", h or ""):
            return None
        return read_json(self.p("objects", h[:2], h + ".json"))

    # ---- batches
    def head(self) -> Optional[str]:
        try:
            return self.p("HEAD").read_text().strip() or None
        except FileNotFoundError:
            return None

    def set_head(self, batch_id: str) -> None:
        atomic_write_bytes(self.p("HEAD"), (batch_id + "\n").encode())

    def get_batch(self, batch_id: str) -> Optional[dict]:
        if not re.fullmatch(r"[A-Za-z0-9_\-]{3,80}", batch_id or ""):
            return None
        return read_json(self.p("batches", batch_id + ".json"))

    def list_batches(self) -> List[dict]:
        out = []
        d = self.p("batches")
        if d.is_dir():
            for f in sorted(d.glob("*.json")):
                b = read_json(f)
                if b:
                    out.append(b)
        out.sort(key=lambda b: b.get("revision", 0))
        return out

    # ---- events
    def events(self, after_seq: int = 0) -> Iterator[dict]:
        for e in read_jsonl(self.p("events.jsonl")):
            if e.get("seq", 0) > after_seq:
                yield e

    def head_seq(self) -> int:
        last = 0
        for e in read_jsonl(self.p("events.jsonl")):
            last = max(last, e.get("seq", 0))
        return last

    def append_events(self, rows: List[dict]) -> int:
        """分配連續 seq；以 event_key 去重（崩潰後補寫不重複）。須在 store lock 內。"""
        existing = {e.get("event_key") for e in read_jsonl(self.p("events.jsonl"))}
        seq = self.head_seq()
        new = []
        for r in rows:
            if r["event_key"] in existing:
                continue
            seq += 1
            r = dict(r, seq=seq)
            new.append(r)
        append_jsonl(self.p("events.jsonl"), new)
        return len(new)

    # ---- state replay（固定版本快照 = 重播到 seq）
    def state_at(self, seq: Optional[int] = None) -> Dict[str, Any]:
        items: Dict[str, str] = {}
        item_rev: Dict[str, int] = {}
        withdrawn: Dict[str, str] = {}
        last = 0
        for e in self.events():
            if seq is not None and e["seq"] > seq:
                break
            last = e["seq"]
            t = e["type"]
            iid = e.get("item_id")
            if t in ("item_added", "item_changed"):
                items[iid] = e["hash"]
                item_rev[iid] = e["seq"]
                withdrawn.pop(iid, None)
            elif t == "item_withdrawn":
                items.pop(iid, None)
                item_rev[iid] = e["seq"]
                withdrawn[iid] = e.get("reason", "missing_from_source")
        return {"seq": last, "items": items, "item_rev": item_rev, "withdrawn": withdrawn}

    # ---- corrections / exclusions
    def corrections(self) -> List[dict]:
        return list(read_jsonl(self.p("corrections.jsonl")))

    def add_correction(self, item_id: str, field: str, new_value: Any, reason: str, by: str,
                       key: Optional[str] = None, kind: str = "field") -> Optional[dict]:
        """append-only。key 相同視為已記錄（冪等）。須在 lock 內由 ingest 呼叫，或自行 with store.lock。"""
        rows = self.corrections()
        key = key or f"{item_id}:{field}:{sha256_bytes(canon(new_value))[:16]}"
        if any(r["key"] == key for r in rows):
            return None
        seq = max((r["corr_seq"] for r in rows), default=0) + 1
        row = {"corr_seq": seq, "key": key, "item_id": item_id, "field": field, "new_value": new_value,
               "reason": reason, "by": by, "at": now_iso(), "kind": kind}
        append_jsonl(self.p("corrections.jsonl"), [row])
        return row

    def exclusions(self) -> List[dict]:
        return list(read_jsonl(self.p("exclusions.jsonl")))

    def add_exclusion(self, ref: str, reason: str, source: str, key: Optional[str] = None) -> Optional[dict]:
        rows = self.exclusions()
        key = key or f"{ref}:{reason}"
        if any(r["key"] == key for r in rows):
            return None
        row = {"excl_seq": max((r["excl_seq"] for r in rows), default=0) + 1, "key": key, "ref": ref,
               "reason": reason, "source": source, "at": now_iso()}
        append_jsonl(self.p("exclusions.jsonl"), [row])
        return row

    # ---- health
    def record_health(self, row: dict) -> None:
        append_jsonl(self.p("health.jsonl"), [dict(row, at=row.get("at") or now_iso())])

    def health_rows(self) -> List[dict]:
        return list(read_jsonl(self.p("health.jsonl")))

    # ---- checkpoints（各代理獨立；ack 只在成功匯入後由代理呼叫）
    def _cp_path(self, agent: str) -> Path:
        return self.p("checkpoints", agent + ".json")

    def checkpoint(self, agent: str) -> dict:
        if not AGENT_RE.match(agent or ""):
            raise StoreError("bad agent id")
        return read_json(self._cp_path(agent)) or {
            "agent": agent, "acked_seq": 0, "served_through": 0, "last_ack_at": None,
            "last_failure": None, "failures": 0}

    def serve(self, agent: str, through_seq: int) -> dict:
        with self.lock:
            cp = self.checkpoint(agent)
            cp["served_through"] = max(cp["served_through"], through_seq)
            atomic_write_bytes(self._cp_path(agent), json.dumps(cp, ensure_ascii=False, indent=1).encode())
            return cp

    def ack(self, agent: str, through_seq: int, import_receipt: Optional[str] = None) -> dict:
        with self.lock:
            cp = self.checkpoint(agent)
            if through_seq <= cp["acked_seq"]:
                return dict(cp, idempotent=True)  # 重跑不重複、不倒退
            if through_seq > cp["served_through"]:
                raise StoreError(f"cannot ack {through_seq} beyond served_through={cp['served_through']}")
            cp.update(acked_seq=through_seq, last_ack_at=now_iso(), last_failure=None,
                      import_receipt=import_receipt)
            atomic_write_bytes(self._cp_path(agent), json.dumps(cp, ensure_ascii=False, indent=1).encode())
            return cp

    def report_failure(self, agent: str, error: str, seq: Optional[int] = None) -> dict:
        with self.lock:
            cp = self.checkpoint(agent)
            cp["failures"] = cp.get("failures", 0) + 1
            cp["last_failure"] = {"at": now_iso(), "error": str(error)[:500], "seq": seq}
            atomic_write_bytes(self._cp_path(agent), json.dumps(cp, ensure_ascii=False, indent=1).encode())
            return cp  # acked_seq 不動
