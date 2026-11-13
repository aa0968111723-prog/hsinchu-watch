# -*- coding: utf-8 -*-
"""固定政治資料 MCP（stdio）：供五條代理增量匯入。

  python -m hourly.mcp_political --store hourly_store

增量協定（至少一次、冪等）：
  hw_pull_events(agent_id, limit)  → 從該代理已確認 cursor 之後取一頁（不推進 cursor；同頁可重取）
  代理匯入成功後 → hw_ack(agent_id, through_seq)；失敗 → hw_report_failure（cursor 不動）
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from . import views
from .mcp_stdio import Server, Tool, ToolError
from .store import AGENT_RE, DEFAULT_AGENTS, Store, StoreError
from .util import now_iso

STALE_MINUTES = 90  # 每小時批次；超過 90 分鐘無成功批次即過期
MAX_PAGE = 500


def _age_minutes(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        t = datetime.fromisoformat(iso)
    except ValueError:
        return None
    return round((datetime.now(timezone.utc) - t.astimezone(timezone.utc)).total_seconds() / 60, 1)


def build(store: Store, agents=DEFAULT_AGENTS) -> Server:
    def agent_of(a: dict) -> str:
        ag = a["agent_id"]
        if not AGENT_RE.match(ag):
            raise ToolError("bad agent_id")
        if ag not in agents:
            raise ToolError(f"unregistered agent_id; registered: {list(agents)}")
        return ag

    def status(_a):
        head = store.head()
        b = store.get_batch(head) if head else None
        rows = store.health_rows()
        ok_rows = [r for r in rows if r.get("kind") == "ingest" and r.get("ok")]
        fail_rows = [r for r in rows if r.get("kind") == "ingest" and not r.get("ok")]
        last_ok = ok_rows[-1]["at"] if ok_rows else None
        last_fail = fail_rows[-1] if fail_rows else None
        age = _age_minutes(last_ok)
        stale = age is None or age > STALE_MINUTES
        failing_now = bool(last_fail and (not last_ok or last_fail["at"] > last_ok))
        return {
            "head_batch": head, "revision": b["revision"] if b else None, "head_seq": store.head_seq(),
            "batch_created_at": b["created_at"] if b else None,
            "last_success_at": last_ok, "age_minutes": age, "stale": stale, "stale_after_minutes": STALE_MINUTES,
            "ingest_failing_now": failing_now,
            "last_failure": ({k: last_fail.get(k) for k in ("at", "code", "detail")} if last_fail else None),
            "serving": "last_good_data" if failing_now else "latest",
            "base": ({k: b.get(k) for k in ("source_commit", "source_tree_dirty", "base_main_commit",
                                            "base_live_release", "live_manifest_hash", "live_data_sha256")} if b else None),
            "counts": b["counts"] if b else None,
            "registered_agents": list(agents),
            "published": False,
            "publish_state": "已交第四線，尚待整合發布（本 MCP 不發布；已發布須第四線提供線上驗證證據）",
            "fairness": views.FAIRNESS,
        }

    def source_health(_a):
        head = store.head()
        b = store.get_batch(head) if head else None
        sh = b["source_health"] if b else {}
        gaps = [{"source": k, "status": v["status"], "note": v.get("note")}
                for k, v in sh.items() if v["status"] != "ok"]
        if b and b.get("live_manifest_error"):
            gaps.append({"source": "live_manifest", "status": "error", "note": b["live_manifest_error"]})
        st = status({})
        return {"as_of_batch": head, "sources": sh, "coverage_gaps": gaps,
                "stale": st["stale"], "age_minutes": st["age_minutes"],
                "note": "disabled_platform_limit＝robots/登入/驗證/付費牆等平台限制，如實記錄，不繞過；ok_count null＝未知，不是 0。"}

    def pull_events(a):
        ag = agent_of(a)
        limit = min(a.get("limit", 100), MAX_PAGE)
        cp = store.checkpoint(ag)
        after = cp["acked_seq"]
        page, more = [], False
        for e in store.events(after):
            if len(page) >= limit:
                more = True
                break
            page.append(e)
        if a.get("include_items"):
            for e in page:
                if e["type"] in ("item_added", "item_changed"):
                    e["item"] = store.get_object(e["hash"])
        through = page[-1]["seq"] if page else after
        if page:
            store.serve(ag, through)
        return {"agent_id": ag, "after_seq": after, "through_seq": through, "count": len(page),
                "has_more": more, "events": page,
                "next": "匯入成功後呼叫 hw_ack(agent_id, through_seq)；失敗請 hw_report_failure，cursor 不會動。",
                "head_seq": store.head_seq(), "stale": status({})["stale"]}

    def ack(a):
        ag = agent_of(a)
        try:
            cp = store.ack(ag, a["through_seq"], a.get("import_receipt"))
        except StoreError as e:
            raise ToolError(str(e))
        return {"agent_id": ag, "acked_seq": cp["acked_seq"], "idempotent": bool(cp.get("idempotent"))}

    def fail(a):
        ag = agent_of(a)
        cp = store.report_failure(ag, a["error"], a.get("seq"))
        return {"agent_id": ag, "acked_seq": cp["acked_seq"], "failures": cp["failures"],
                "note": "cursor 未移動；下次 pull 從同一位置重取"}

    def checkpoint(a):
        ag = agent_of(a)
        cp = store.checkpoint(ag)
        cp["lag_events"] = max(0, store.head_seq() - cp["acked_seq"])
        return cp

    def get_item(a):
        v = views.item_view(store, a["item_id"], a.get("at_seq"))
        if v is None:
            raise ToolError("item not found")
        return v

    def versions(_a):
        return {"versions": [{"batch_id": b["batch_id"], "revision": b["revision"], "created_at": b["created_at"],
                              "state_sha": b["state_sha"], "counts": b["counts"]} for b in store.list_batches()],
                "head_batch": store.head()}

    def snapshot(a):
        b = store.get_batch(a["batch_id"])
        if not b:
            raise ToolError("batch not found")
        ids_ok = {pb["batch_id"] for pb in store.list_batches() if pb["revision"] <= b["revision"]}
        seq_end = max((e["seq"] for e in store.events() if e.get("batch_id") in ids_ok), default=0)
        st = store.state_at(seq_end)
        ids = sorted(st["items"])
        off, lim = a.get("offset", 0), min(a.get("limit", 200), MAX_PAGE)
        return {"batch_id": b["batch_id"], "revision": b["revision"], "state_sha": b["state_sha"],
                "seq_end": seq_end, "total": len(ids), "offset": off,
                "items": [{"id": i, "hash": st["items"][i]} for i in ids[off:off + lim]],
                "has_more": off + lim < len(ids),
                "note": "固定版本：同一 batch_id 永遠回同一組 id→content hash；以 hw_get_item(at_seq=seq_end) 取內容。"}

    def corrections(a):
        rows = [c for c in store.corrections() if c["corr_seq"] > a.get("after_corr_seq", 0)]
        lim = min(a.get("limit", 100), MAX_PAGE)
        return {"corrections": rows[:lim], "has_more": len(rows) > lim,
                "note": "更正歷史只增不改；較新更正不會被舊批次覆蓋。"}

    def exclusions(a):
        rows = [c for c in store.exclusions() if c["excl_seq"] > a.get("after_excl_seq", 0)]
        lim = min(a.get("limit", 100), MAX_PAGE)
        return {"exclusions": rows[:lim], "has_more": len(rows) > lim}

    S = lambda props, req=(): {"type": "object", "properties": props, "required": list(req)}  # noqa: E731
    agent = {"type": "string", "description": "代理線 id，例 line1..line5"}
    tools = [
        Tool("hw_status", "批次、cursor head、過期狀態、基準（base main／live release）、發布狀態。", S({}), status),
        Tool("hw_source_health", "來源健康與覆蓋缺口（平台限制如實記錄）。", S({}), source_health),
        Tool("hw_pull_events", "依持久化事件序號取該代理 cursor 之後的一頁增量（不推進 cursor）。",
             S({"agent_id": agent, "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE},
                "include_items": {"type": "boolean"}}, ["agent_id"]), pull_events),
        Tool("hw_ack", "匯入成功後確認 cursor（不可超過已提供的 through_seq；重複確認冪等）。",
             S({"agent_id": agent, "through_seq": {"type": "integer", "minimum": 1},
                "import_receipt": {"type": "string"}}, ["agent_id", "through_seq"]), ack, read_only=False),
        Tool("hw_report_failure", "匯入失敗回報；cursor 不動。",
             S({"agent_id": agent, "error": {"type": "string"}, "seq": {"type": "integer"}}, ["agent_id", "error"]),
             fail, read_only=False),
        Tool("hw_checkpoint", "查詢該代理獨立 checkpoint 與落後事件數。", S({"agent_id": agent}, ["agent_id"]), checkpoint),
        Tool("hw_get_item", "單筆詳情（含更正疊加、待審狀態）；可指定 at_seq 看固定版本內容。",
             S({"item_id": {"type": "string"}, "at_seq": {"type": "integer", "minimum": 1}}, ["item_id"]), get_item),
        Tool("hw_list_versions", "列出不可變批次版本。", S({}), versions),
        Tool("hw_get_snapshot", "固定版本快照（id→content hash，分頁）。",
             S({"batch_id": {"type": "string"}, "offset": {"type": "integer", "minimum": 0},
                "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE}}, ["batch_id"]), snapshot),
        Tool("hw_list_corrections", "更正歷史（append-only，分頁）。",
             S({"after_corr_seq": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1,
                                                                               "maximum": MAX_PAGE}}), corrections),
        Tool("hw_list_exclusions", "排除／待審清單歷史（append-only，分頁）。",
             S({"after_excl_seq": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1,
                                                                               "maximum": MAX_PAGE}}), exclusions),
    ]
    return Server("hsinchu-watch-hourly", "0.1.0", tools,
                  "唯一寫入面是 per-agent checkpoint（hw_ack／hw_report_failure）；不發布、不連 Cloudflare。")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", default="hourly_store")
    ns = ap.parse_args(argv)
    build(Store(ns.store)).serve()
    return 0


if __name__ == "__main__":
    sys.exit(main())
