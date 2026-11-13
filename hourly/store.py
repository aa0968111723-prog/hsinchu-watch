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

from .util import (is_raw_url, url_ref, FileLock, append_jsonl, atomic_write_bytes, canon, now_iso, read_json, read_jsonl,
                   sha256_bytes)

AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,39}$")
DEFAULT_AGENTS = ("line1", "line2", "line3", "line4", "line5")  # 五條代理；line4＝整合發布線


class StoreError(Exception):
    pass


class Store:
    def __init__(self, root: Path | str, create: bool = True):
        self.root = Path(root)
        if create:
            self.root.mkdir(parents=True, exist_ok=True)
        elif not self.root.is_dir():
            raise StoreError(f"store not found: {self.root.name}")
        self.lock = FileLock(self.root / ".store.lock")

    # ---- paths
    def p(self, *a: str) -> Path:
        return self.root.joinpath(*a)

    # ---- objects
    def put_object(self, obj: dict, key: Optional[str] = None) -> str:
        """內容定址：key＝穩定內容雜湊（不含每輪變動欄位）。已存在則保留首版（同內容不覆寫）。"""
        data = canon(obj)
        h = key or sha256_bytes(data)
        path = self.p("objects", h[:2], h + ".json")
        if not path.exists():
            atomic_write_bytes(path, data, immutable=True)
        return h

    def get_object(self, h: str) -> Optional[dict]:
        if not re.fullmatch(r"[0-9a-f]{64}", h or ""):
            return None
        return read_json(self.p("objects", h[:2], h + ".json"))

    # ---- HEAD：最後成功批次 + 已提交事件序號（讀取路徑只看見已提交事件）
    def _head_doc(self) -> dict:
        try:
            raw = self.p("HEAD").read_text().strip()
        except FileNotFoundError:
            return {}
        if not raw:
            return {}
        if raw.startswith("{"):
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return {}
        return {"batch_id": raw, "seq": None}  # 舊格式（純 batch id）：不設上限

    def head(self) -> Optional[str]:
        return self._head_doc().get("batch_id") or None

    def committed_seq(self) -> Optional[int]:
        """None＝尚無 HEAD（尚未提交任何批次）或舊格式；有 HEAD 時為已提交上限。"""
        d = self._head_doc()
        if not d:
            return 0
        return d.get("seq")

    def set_head(self, batch_id: str, seq: Optional[int] = None) -> None:
        seq = self.raw_max_seq() if seq is None else seq
        atomic_write_bytes(self.p("HEAD"), json.dumps({"batch_id": batch_id, "seq": seq}).encode())

    def commit_all(self) -> None:
        """把目前檔內所有事件視為已提交（人工補寫／測試用；一般由 ingest 的 set_head 提交）。"""
        h = self.head()
        if h:
            self.set_head(h, self.raw_max_seq())

    def assert_writable(self) -> None:
        """寫入前預檢：任何目標目錄不可寫就在動任何檔之前失敗（避免留下孤兒物件）。"""
        import os
        for d in (self.root, self.p("objects"), self.p("batches")):
            d.mkdir(parents=True, exist_ok=True)
            if not os.access(d, os.W_OK | os.X_OK):
                raise OSError(f"store dir not writable: {d.name}")

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
    def _raw_events(self) -> List[dict]:
        return sorted(read_jsonl(self.p("events.jsonl")), key=lambda e: e.get("seq", 0))

    def events(self, after_seq: int = 0) -> Iterator[dict]:
        """只回已提交（seq ≤ HEAD.seq）的事件，依 seq 排序。"""
        cap = self.committed_seq()
        for e in self._raw_events():
            sq = e.get("seq", 0)
            if sq > after_seq and (cap is None or sq <= cap):
                yield e

    def raw_max_seq(self) -> int:
        return max((e.get("seq", 0) for e in read_jsonl(self.p("events.jsonl"))), default=0)

    def head_seq(self) -> int:
        """已提交的最大事件序號。"""
        cap = self.committed_seq()
        return self.raw_max_seq() if cap is None else cap

    def append_events(self, rows: List[dict]) -> int:
        """分配連續 seq（以檔內最大 seq 為準）；event_key 去重。寫入後仍「未提交」，須 set_head 才可見。"""
        existing = {e.get("event_key") for e in read_jsonl(self.p("events.jsonl"))}
        seq = self.raw_max_seq()
        new = []
        for r in rows:
            if r["event_key"] in existing:
                continue
            seq += 1
            new.append(dict(r, seq=seq))
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
                continue
            last = max(last, e["seq"])
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
        if is_raw_url(ref):
            ref = url_ref(ref)  # 防呆：任何呼叫路徑都不得存原始 URL
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
            "agent": agent, "acked_seq": 0, "last_ack_at": None,
            "last_failure": None, "failures": 0}

    @staticmethod
    def page_token(agent: str, after_seq: int, events: List[dict]) -> str:
        """該頁（after_seq, through_seq]的內容摘要；pull 為純讀，ack 時重算比對（無需寫 served_through）。"""
        through = max((e["seq"] for e in events), default=after_seq)
        return sha256_bytes(canon([agent, after_seq, through, [e["event_key"] for e in events]]))[:32]

    def page_after(self, agent: str, after_seq: int, limit: int) -> List[dict]:
        out = []
        for e in self.events(after_seq):  # 已依 seq 排序
            if len(out) >= limit:
                break
            out.append(e)
        return out

    def ack(self, agent: str, through_seq: int, ack_token: str, import_receipt: Optional[str] = None) -> dict:
        """只有「從目前已確認 cursor 起、剛好到 through_seq 的那一頁」的 token 才能確認；不可跳頁、不可倒退。"""
        with self.lock:
            cp = self.checkpoint(agent)
            if through_seq <= cp["acked_seq"]:
                return dict(cp, idempotent=True)  # 重跑不重複、不倒退
            page = self.page_after(agent, cp["acked_seq"], 10 ** 9)
            page = [e for e in page if e["seq"] <= through_seq]
            if not page or max(e["seq"] for e in page) != through_seq:
                raise StoreError(f"through_seq {through_seq} is not an event boundary after cursor {cp['acked_seq']}")
            if self.page_token(agent, cp["acked_seq"], page) != ack_token:
                raise StoreError("ack_token mismatch (page differs from what was pulled; re-pull)")
            cp.update(acked_seq=through_seq, last_ack_at=now_iso(), last_failure=None, import_receipt=import_receipt)
            atomic_write_bytes(self._cp_path(agent), json.dumps(cp, ensure_ascii=False, indent=1).encode())
            return cp

    def report_failure(self, agent: str, error: str, seq: Optional[int] = None) -> dict:
        with self.lock:
            cp = self.checkpoint(agent)
            cp["failures"] = cp.get("failures", 0) + 1
            cp["last_failure"] = {"at": now_iso(), "error": str(error)[:500], "seq": seq}
            atomic_write_bytes(self._cp_path(agent), json.dumps(cp, ensure_ascii=False, indent=1).encode())
            return cp  # acked_seq 不動
