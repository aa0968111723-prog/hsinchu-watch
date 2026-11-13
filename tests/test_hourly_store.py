# -*- coding: utf-8 -*-
"""批次／store／政治 MCP：待審預設、排除帳不存原始 URL、local 檔略過、cursor 與 ack 語意、失敗保留最後成功資料。"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import hourly_fixtures as fx
from hourly import batch as hb, mcp_political, views
from hourly.store import Store, StoreError
from hourly.util import url_ref

CTX = {"source_commit": "c" * 40}
RAW = "https://www.facebook.com/some.private.person/posts/123"


def srv(store):
    s = mcp_political.build(store)

    def call(name, args=None):
        r = s.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        return r.get("structuredContent") if not r.get("isError") else {"__error__": r["content"][0]["text"]}
    return call


def test_ingest_all_new_items_pending_never_checked(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(i) for i in range(4)])
    r = hb.ingest(d, st, CTX)
    assert r["counts"]["added"] == 4 and r["counts"]["pending_review"] == 4
    for e in st.events():
        assert e["verification"] == "待審"
    v = views.item_view(st, "item0001")
    assert v["verification_status"] == "待審"
    blob = "".join(p.read_text() for p in st.root.rglob("*.json*"))
    assert "已查核" not in blob.replace("never auto 已查核", "")


def test_ingest_idempotent_noop_no_new_events(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(i) for i in range(4)])
    hb.ingest(d, st, CTX)
    seq, head = st.head_seq(), st.head()
    r = hb.ingest(d, st, CTX)
    assert r["status"] == "noop" and st.head_seq() == seq and st.head() == head


def test_incremental_only_delta_and_corrections_kept(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(i) for i in range(4)])
    hb.ingest(d, st, CTX)
    it = [fx.item(i) for i in range(5)]
    it[1]["title"] = "改過的標題"
    fx.write_data(d, it, decisions={"item0002": {"decision": "confirmed", "verified_at": "2026-11-13T08:00:00+08:00"}})
    r = hb.ingest(d, st, CTX)
    assert r["counts"]["added"] == 1 and r["counts"]["changed"] == 1 and r["counts"]["new_corrections"] == 1
    assert views.item_view(st, "item0002")["verification_status"] == "人工核對上架"  # 只有人工裁決才改
    assert views.item_view(st, "item0003")["verification_status"] == "待審"
    # 批次不可變：重寫同 id 但內容不同必須失敗
    from hourly.util import atomic_write_bytes
    with pytest.raises(FileExistsError):
        atomic_write_bytes(st.p("batches", r["batch_id"] + ".json"), b"{}", immutable=True)


def test_batch_records_base_fields_and_file_hashes(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(1)])
    ctx = dict(CTX, base_main_commit="a" * 40, base_live_release="rel-1", live_manifest_hash="h" * 64, live_data_sha256="d" * 64)
    b = st.get_batch(hb.ingest(d, st, ctx)["batch_id"])
    for k in ("batch_id", "source_commit", "base_main_commit", "base_live_release", "live_manifest_hash", "revision", "state_sha"):
        assert b[k]
    assert "items.json" in b["file_hashes"] and len(b["file_hashes"]["items.json"]) == 64


def test_exclusion_ledger_never_stores_raw_url(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(1)], excluded=[{"kind": "item", "url": RAW, "reason": "official_social_domain"},
                                             {"kind": "item", "id": "idx1", "url": RAW + "2", "reason": "x"}])
    hb.ingest(d, st, CTX)
    rows = st.exclusions()
    assert any(r["ref"] == url_ref(RAW) for r in rows) and any(r["ref"] == "idx1" for r in rows)
    everything = "".join(p.read_text() for p in st.root.rglob("*") if p.is_file() and p.suffix in (".json", ".jsonl"))
    assert "facebook.com/some.private.person" not in everything
    st.add_exclusion(RAW, "r", "t")  # 任何路徑都會被轉成雜湊
    assert all(not r["ref"].startswith("http") for r in st.exclusions())
    out = srv(st)("hw_list_exclusions", {})
    assert "http" not in json.dumps(out)


def test_local_excluded_urls_file_skipped_entirely(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(1)])
    (d / "excluded_urls.local.json").write_text(json.dumps({"x": "https://secret.example/PRIVATE-MARKER-123"}))
    b = st.get_batch(hb.ingest(d, st, CTX)["batch_id"])
    assert "excluded_urls.local.json" not in b["file_hashes"]
    assert "PRIVATE-MARKER-123" not in "".join(p.read_text() for p in st.root.rglob("*") if p.is_file())


def test_privacy_keys_stripped_and_excerpt_capped(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    it = fx.item(1)
    it.update(author="某留言者", handle="@x", inbox_account="acct", anonymous_excerpt="字" * 80, engagement=None)
    fx.write_data(d, [it])
    hb.ingest(d, st, CTX)
    v = views.item_view(st, "item0001")
    assert "author" not in v and "handle" not in v and "inbox_account" not in v
    assert len(v["anonymous_excerpt"]) == 30
    assert v["engagement"] is None  # 未知不是 0


def test_failure_keeps_last_good_and_status_shows_stale_and_gaps(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(i) for i in range(10)])
    ok = hb.ingest(d, st, CTX)
    head = st.head()
    fx.write_data(d, [fx.item(1)])  # 掉量 >50% → suspicious_drop
    bad = hb.ingest(d, st, CTX)
    assert bad["status"] == "failed" and bad["code"] == "suspicious_drop" and st.head() == head
    (d / "items.json").write_text("not json")
    assert hb.ingest(d, st, CTX)["status"] == "failed"
    assert views.item_view(st, "item0009") is not None  # 最後成功資料仍在
    s = srv(st)("hw_status")
    assert s["ingest_failing_now"] is True and s["serving"] == "last_good_data" and s["last_failure"]["code"]
    sh = srv(st)("hw_source_health")
    assert any(g["source"] == "ptt" and g["status"] == "disabled_platform_limit" for g in sh["coverage_gaps"])
    assert s["published"] is False and "尚待整合發布" in s["publish_state"]


def test_crash_between_batch_file_and_head_recovers(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(i) for i in range(3)])
    hb.ingest(d, st, CTX)
    fx.write_data(d, [fx.item(i) for i in range(4)])
    r = hb.ingest(d, st, CTX)
    # 模擬崩潰：HEAD 退回、事件檔截到上一批
    prev = st.get_batch(r["batch_id"])["prev_batch_id"]
    st.set_head(prev)
    lines = st.p("events.jsonl").read_text().splitlines()
    st.p("events.jsonl").write_text("\n".join(lines[:-1]) + "\n")
    assert hb.recover(st) == r["batch_id"]
    assert st.head() == r["batch_id"] and st.head_seq() == 4
    assert hb.recover(st) is None  # 冪等


# ---- cursor / ack
def test_pull_is_pure_read_and_ack_requires_token(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(i) for i in range(5)])
    hb.ingest(d, st, CTX)
    call = srv(st)
    p1 = call("hw_pull_events", {"agent_id": "line1", "limit": 2})
    assert not st.p("checkpoints").exists()                       # 純讀：沒寫任何 checkpoint
    p1b = call("hw_pull_events", {"agent_id": "line1", "limit": 2})
    assert p1b["events"] == p1["events"] and p1b["ack_token"] == p1["ack_token"]  # 重取同頁
    assert "__error__" in call("hw_ack", {"agent_id": "line1", "through_seq": 2, "ack_token": "bad"})
    assert "__error__" in call("hw_ack", {"agent_id": "line1", "through_seq": 5, "ack_token": p1["ack_token"]})  # 不可跳頁
    assert call("hw_checkpoint", {"agent_id": "line1"})["acked_seq"] == 0   # 失敗的 ack 不動 cursor
    ok = call("hw_ack", {"agent_id": "line1", "through_seq": 2, "ack_token": p1["ack_token"]})
    assert ok["acked_seq"] == 2 and ok["idempotent"] is False
    again = call("hw_ack", {"agent_id": "line1", "through_seq": 2, "ack_token": p1["ack_token"]})
    assert again["acked_seq"] == 2 and again["idempotent"] is True        # 重跑冪等
    p2 = call("hw_pull_events", {"agent_id": "line1", "limit": 10})
    assert [e["seq"] for e in p2["events"]] == [3, 4, 5] and p2["after_seq"] == 2


def test_failed_import_keeps_cursor_and_agents_are_independent(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(i) for i in range(3)])
    hb.ingest(d, st, CTX)
    call = srv(st)
    p = call("hw_pull_events", {"agent_id": "line2"})
    f = call("hw_report_failure", {"agent_id": "line2", "error": "db down"})
    assert f["acked_seq"] == 0 and f["failures"] == 1
    p_again = call("hw_pull_events", {"agent_id": "line2"})
    assert p_again["events"] == p["events"]
    call("hw_ack", {"agent_id": "line3", "through_seq": 3, "ack_token": call("hw_pull_events", {"agent_id": "line3"})["ack_token"]})
    assert call("hw_checkpoint", {"agent_id": "line3"})["acked_seq"] == 3
    assert call("hw_checkpoint", {"agent_id": "line2"})["acked_seq"] == 0   # 各線獨立
    assert "__error__" in call("hw_pull_events", {"agent_id": "stranger"})
    assert "__error__" in call("hw_pull_events", {"agent_id": "../x"})


def test_offline_agent_does_not_miss_intermediate_events(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(i) for i in range(2)])
    hb.ingest(d, st, CTX)
    call = srv(st)
    for n in (3, 4, 5):
        fx.write_data(d, [fx.item(i) for i in range(n)])
        hb.ingest(d, st, CTX)
    got = []
    while True:
        p = call("hw_pull_events", {"agent_id": "line5", "limit": 2})
        if not p["events"]:
            break
        got += [e["seq"] for e in p["events"]]
        call("hw_ack", {"agent_id": "line5", "through_seq": p["through_seq"], "ack_token": p["ack_token"]})
    assert got == [1, 2, 3, 4, 5]


def test_pinned_snapshot_and_at_seq_freeze_corrections(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(i) for i in range(3)])
    b1 = hb.ingest(d, st, CTX)
    fx.write_data(d, [fx.item(i) for i in range(4)], decisions={"item0001": {"decision": "confirmed", "verified_at": "t"}})
    b2 = hb.ingest(d, st, CTX)
    call = srv(st)
    s1 = call("hw_get_snapshot", {"batch_id": b1["batch_id"]})
    assert s1["total"] == 3 and call("hw_get_snapshot", {"batch_id": b1["batch_id"]}) == s1   # 固定版本
    assert call("hw_get_snapshot", {"batch_id": b2["batch_id"]})["total"] == 4
    assert call("hw_get_item", {"item_id": "item0001", "at_seq": s1["seq_end"]})["verification_status"] == "待審"
    assert call("hw_get_item", {"item_id": "item0001"})["verification_status"] == "人工核對上架"


def test_stdio_process_handshake(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(1)])
    hb.ingest(d, st, CTX)
    msgs = [{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "hw_status", "arguments": {}}},
            {"jsonrpc": "2.0", "id": 4, "method": "nope"}]
    p = subprocess.run([sys.executable, "-m", "hourly.mcp_political", "--store", str(st.root)], input="\n".join(map(json.dumps, msgs)) + "\n",
                       capture_output=True, text=True, timeout=30, cwd=Path(__file__).resolve().parents[1])
    out = [json.loads(l) for l in p.stdout.splitlines()]
    assert [o["id"] for o in out] == [1, 2, 3, 4]       # 通知沒有回應
    assert out[0]["result"]["serverInfo"]["name"] == "hsinchu-watch-hourly"
    names = {t["name"] for t in out[1]["result"]["tools"]}
    assert {"hw_status", "hw_pull_events", "hw_ack", "hw_get_item", "hw_get_snapshot"} <= names
    ro = {t["name"]: t["annotations"]["readOnlyHint"] for t in out[1]["result"]["tools"]}
    assert ro["hw_pull_events"] is True and ro["hw_ack"] is False
    assert out[3]["error"]["code"] == -32601


def test_tool_argument_validation(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(1)])
    hb.ingest(d, st, CTX)
    call = srv(st)
    assert "__error__" in call("hw_pull_events", {"agent_id": "line1", "limit": 0})
    assert "__error__" in call("hw_pull_events", {"agent_id": "line1", "limit": 99999})
    assert "__error__" in call("hw_pull_events", {"agent_id": "line1", "bogus": 1})
    assert "__error__" in call("hw_get_item", {"item_id": "x" * 5000})


# ---- 資料庫測試專家回報的缺陷回歸
def test_out_of_order_seq_cursor_reaches_max(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(1)])
    hb.ingest(d, st, CTX)  # seq 1
    from hourly.util import append_jsonl
    for sq in (10, 12, 11):  # 日誌亂序補寫
        append_jsonl(st.p("events.jsonl"), [{"seq": sq, "event_key": f"k{sq}", "type": "item_added", "item_id": f"z{sq}",
                                             "hash": "a" * 64, "batch_id": "b"}])
    st.commit_all()
    assert [e["seq"] for e in st.events()] == [1, 10, 11, 12]          # 依 seq 排序
    assert st.state_at(11)["seq"] == 11 and "z12" not in st.state_at(11)["items"]   # state_at 不因亂序提早 break
    call = srv(st)
    p = call("hw_pull_events", {"agent_id": "line1", "limit": 100})
    assert p["through_seq"] == 12
    assert call("hw_ack", {"agent_id": "line1", "through_seq": 12, "ack_token": p["ack_token"]})["acked_seq"] == 12


def test_uncommitted_events_invisible_until_head_commit(tmp_path):
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(i) for i in range(3)])
    hb.ingest(d, st, CTX)
    # 模擬 kill：事件已寫、HEAD 尚未提交
    st.append_events([{"event_key": "late", "type": "item_added", "item_id": "late1", "hash": "b" * 64, "batch_id": "bX"}])
    assert st.raw_max_seq() == 4 and st.head_seq() == 3
    assert "late1" not in st.state_at()["items"]
    assert [e["seq"] for e in st.events()] == [1, 2, 3]
    assert srv(st)("hw_status")["head_seq"] == 3
    st.commit_all()
    assert "late1" in st.state_at()["items"]


def test_unwritable_store_fails_before_writing_anything(tmp_path):
    import os
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(i) for i in range(3)])
    hb.ingest(d, st, CTX)
    before = sorted(str(p.relative_to(st.root)) for p in st.root.rglob("*"))
    fx.write_data(d, [fx.item(i) for i in range(4)])
    os.chmod(st.p("batches"), 0o555)
    try:
        if os.access(st.p("batches"), os.W_OK):
            pytest.skip("running as a user that ignores chmod")
        r = hb.ingest(d, st, CTX)
    finally:
        os.chmod(st.p("batches"), 0o755)
    assert r["status"] == "failed"
    assert sorted(str(p.relative_to(st.root)) for p in st.root.rglob("*")) == before  # 沒有孤兒物件、事件、批次


def test_read_paths_do_not_create_store_or_write(tmp_path):
    from hourly.store import StoreError
    with pytest.raises(StoreError):
        Store(tmp_path / "nope", create=False)
    assert not (tmp_path / "nope").exists()
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [fx.item(1)])
    hb.ingest(d, st, CTX)
    snap = sorted((str(p), p.stat().st_mtime_ns) for p in st.root.rglob("*") if p.is_file())
    c = srv(Store(st.root, create=False))
    for name, args in (("hw_status", {}), ("hw_source_health", {}), ("hw_pull_events", {"agent_id": "line1"}),
                       ("hw_get_item", {"item_id": "item0001"}), ("hw_list_versions", {}), ("hw_checkpoint", {"agent_id": "line1"}),
                       ("hw_list_corrections", {}), ("hw_list_exclusions", {})):
        c(name, args)
    assert sorted((str(p), p.stat().st_mtime_ns) for p in st.root.rglob("*") if p.is_file()) == snap
