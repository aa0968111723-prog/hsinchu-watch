# -*- coding: utf-8 -*-
"""網站唯讀 MCP（stdio 契約＋Streamable HTTP）：視圖守衛、隱私、BLACKOUT、分頁、驗證、限流、CORS、Gemini 風格用戶端。"""
from __future__ import annotations

import http.client
import json
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import hourly_fixtures as fx
from hourly import mcp_http, mcp_site
from hourly.site_view import ViewError, check_view_dir

TZ = timezone(timedelta(hours=8))
NOW = datetime(2026, 11, 13, 9, 0, tzinfo=TZ)
SHA = "ab" * 32


def _item(i, person="wu", **kw):
    d = {"id": f"s{i:03d}", "person_id": person, "person": "吳旭智", "platform": "news", "source_name": "測試報",
         "url": f"https://news.example.test/{i}", "title": f"標題{i}", "summary": "摘要", "published_at": f"2026-11-1{i % 9}T08:00:00+08:00",
         "collected_at": "2026-11-13T08:00:00+08:00", "sentiment": "neu", "is_own_speech": False, "topics": [],
         "engagement": None, "author": "某留言者", "handle": "@x", "inbox_account": "acct", "curated_from": "work/內部/x.json"}
    d.update(kw)
    return d


def write_view(d: Path, generated="2026-11-13T08:30:00+08:00", poll_start="2026-11-18T00:00:00+08:00"):
    d.mkdir(parents=True, exist_ok=True)
    items = [_item(i) for i in range(1, 8)] + [_item(20, "xu", person_name="x"), _item(21, url="javascript:alert(1)"),
                                              _item(22, source_name=""), _item(23, person_id="nobody", person_id_extra=1)]
    items[-1]["person_id"] = "nobody"
    w = lambda n, o: (d / n).write_text(json.dumps(o, ensure_ascii=False), encoding="utf-8")  # noqa: E731
    w("items.json", items)
    w("manifest.json", {"content_sha": SHA, "generated_at": generated, "finalized_at": generated, "timezone": "Asia/Taipei",
                        "persons_order": ["wu", "xu"], "poll_blackout_active": False,
                        "counts": {"items_rows": 11, "excluded": 9, "pending_review": 4, "polls": 2, "not_shown_total": 13},
                        "files": {"items.json": {"bytes": 1, "sha256": "0" * 64}}})
    w("stats.json", {"generated_at": generated, "total_items": 11, "total_rows": 11, "polls_count": 2, "pending_review_count": 4,
                     "persons": [{"id": "wu", "name": "吳旭智", "party": "甲", "role": "候選人"}, {"id": "xu", "name": "徐欣瑩", "party": "乙", "role": "候選人"}],
                     "by_person": {"wu": {"last_24h": 3, "last_7d": 5, "latest": [{"title": "不該出現"}]}},
                     "poll_blackout": {"active": False, "start": poll_start, "end": "2026-11-28T16:00:00+08:00"},
                     "source_stats": {"cna": {"ok": 3}, "ptt": {"ok": 0, "disabled": "robots.txt"}},
                     "source_status": [{"id": "ptt_gossiping", "label": "PTT", "status": "active", "count": 2},
                                       {"title": "混入的項目列", "url": "https://x.test/1", "id": "zz"}],
                     "outlet_distribution": {"overall": {"outlets": [{"name": "測試報", "count": 7}]}},
                     "disclaimer": "d", "timezone": "Asia/Taipei"})
    w("polls.json", [
        {"title": "已核對民調", "url": "https://poll.example.test/1", "source_name": "媒體", "org": "機構", "race": "county_magistrate",
         "person_ids": ["xu"], "published_at": "2026-11-05T00:00:00+08:00", "verified": True, "numbers_hidden": False, "support": {"xu": 40.0},
         "sample_size": 1000, "moe": 3.0},
        {"title": "未核對報導", "url": "https://poll.example.test/2", "source_name": "媒體", "race": "county_magistrate", "person_ids": ["xu"],
         "published_at": "2026-11-06T00:00:00+08:00", "verified": False, "numbers_hidden": True, "support": {"xu": 99.0}, "moe": None}])
    w("policies.json", [{"id": "w001", "person_id": "wu", "kind": "policy", "title": "政見一", "summary": "s", "source_name": "報",
                         "source_url": "https://news.example.test/p1", "published_at": "2026-11-01"},
                        {"id": "w002", "person_id": "wu", "kind": "record", "title": "無來源", "source_name": "", "source_url": ""}])
    w("issue_stances.json", {"issues": [{"id": "transport", "name": "交通", "order": 1, "stances": {
        "wu": {"found": True, "quote": "q", "summary": "s", "source_name": "報", "source_url": "https://news.example.test/s1"},
        "xu": {"found": False}}}]})
    w("candidate_photos.json", {"persons": {"wu": {"public_url": "/img/wu.jpg", "credit_zh": "內政部"}}})


@pytest.fixture(scope="module")
def view(tmp_path_factory):
    d = tmp_path_factory.mktemp("view")
    write_view(d)
    return d


def mk(view, now=NOW, env=None, store=None):
    return mcp_site.build(mcp_site.SiteData(view, store=store, now=lambda: now, env=env or {}))


def call(srv, name, args=None):
    r = srv.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
    return r["structuredContent"] if "structuredContent" in r else {"__proto_error__": r["content"][0]["text"]}


def test_view_guard_rejects_collector_data_and_excluded_files(tmp_path):
    repo = tmp_path / "repo"
    (repo / "collectors").mkdir(parents=True)
    (repo / "data").mkdir()
    (repo / "data" / "manifest.json").write_text("{}")
    with pytest.raises(ViewError):
        check_view_dir(repo / "data")                    # 蒐集端 data/
    v = tmp_path / "v"
    write_view(v)
    (v / "excluded.json").write_text("{}")
    with pytest.raises(ViewError):
        check_view_dir(v)                                # 含蒐集端檔
    (v / "excluded.json").unlink()
    (v / "excluded_urls.local.json").write_text("{}")
    with pytest.raises(ViewError):
        check_view_dir(v)
    with pytest.raises(ViewError):
        check_view_dir(tmp_path / "nope")
    e = tmp_path / "empty"
    e.mkdir()
    with pytest.raises(ViewError):
        check_view_dir(e)                                # 沒有 manifest


def test_tool_contract_has_spec_tools_all_readonly(view):
    s = mk(view)
    spec12 = {"list_people", "get_person", "search_items", "get_item", "list_polls", "get_poll_trend", "list_policies",
              "get_policy", "list_sources", "get_source", "get_manifest", "get_stats"}
    assert spec12 <= set(s.tools) and {"get_release", "list_stances", "get_issue"} <= set(s.tools)
    assert all(t.read_only for t in s.tools.values())
    for t in s.tools.values():  # 公開 MCP 不得有覆寫封閉期／讀待審的旗標
        assert not {"force", "override", "include_pending", "include_excluded", "ignore_blackout"} & set(t.schema["properties"])


def test_every_response_has_data_version_and_stale_flag(view):
    out = call(mk(view), "list_people")
    dv = out["data_version"]
    assert dv["content_sha"] == SHA and dv["timezone"] == "Asia/Taipei" and dv["stale"] is False
    old = call(mk(view, now=NOW + timedelta(hours=5)), "list_people")["data_version"]
    assert old["stale"] is True and old["age_minutes"] > 90


def test_data_stale_error_only_when_configured(view):
    s = mk(view, now=NOW + timedelta(hours=5), env={"HSINCHU_MCP_STALE_ERROR": "1"})
    assert call(s, "list_people")["error"]["code"] == "DATA_STALE"


def test_items_privacy_source_and_unknown_not_zero(view):
    out = call(mk(view), "search_items", {"limit": 100})
    ids = {i["id"] for i in out["items"]}
    assert "s021" not in ids and "s022" not in ids and "s023" not in ids      # 無來源／壞網址／未追蹤人物不回
    for i in out["items"]:
        assert i["source_url"] == i["url"] and i["source_name"]
        assert not {"author", "handle", "inbox_account", "curated_from"} & set(i)
        assert i["engagement"] is None
        assert "layer" in i
    assert "不該出現" not in json.dumps(call(mk(view), "get_person", {"person": "wu"}), ensure_ascii=False)  # by_person.latest 不外流


def test_pagination_cursor_and_invalid_arguments(view):
    s = mk(view)
    p1 = call(s, "search_items", {"person": "wu", "limit": 3})
    assert len(p1["items"]) == 3 and p1["total"] == 7 and p1["next_cursor"]
    p2 = call(s, "search_items", {"person": "wu", "limit": 3, "cursor": p1["next_cursor"]})
    p3 = call(s, "search_items", {"person": "wu", "limit": 3, "cursor": p2["next_cursor"]})
    got = [i["id"] for p in (p1, p2, p3) for i in p["items"]]
    assert len(got) == 7 == len(set(got)) and p3["next_cursor"] is None
    assert call(s, "search_items", {"limit": 101}).get("__proto_error__")        # schema 層拒絕
    assert call(s, "search_items", {"cursor": "garbage"})["error"]["code"] == "INVALID_ARGUMENT"
    assert call(s, "search_items", {"date_from": "not-a-date"})["error"]["code"] == "INVALID_ARGUMENT"
    assert call(s, "get_person", {"person": "nobody"}).get("__proto_error__")      # enum
    assert call(s, "get_item", {"id": "zzz"})["error"]["code"] == "NOT_FOUND"


def test_cursor_invalid_after_data_version_changes(view, tmp_path):
    s = mk(view)
    cur = call(s, "search_items", {"limit": 2})["next_cursor"]
    v2 = tmp_path / "v2"
    write_view(v2)
    m = json.loads((v2 / "manifest.json").read_text())
    m["content_sha"] = "cd" * 32
    (v2 / "manifest.json").write_text(json.dumps(m))
    assert call(mk(v2), "search_items", {"cursor": cur})["error"]["code"] == "INVALID_ARGUMENT"


def test_blackout_config_driven_no_override(view):
    inside = NOW.replace(month=11, day=20)
    s = mk(view, now=inside)
    for tool in ("list_polls", "get_poll_trend"):
        r = call(s, tool, {})
        assert r["error"]["code"] == "BLACKOUT" and "polls" not in r and "points" not in r
        assert "blackout" in r["error"]
    assert "polls" in call(mk(view), "list_polls", {})         # 封閉期外正常
    # 設定可改（環境變數），不是工具參數
    s2 = mk(view, env={"HSINCHU_MCP_BLACKOUT_START": "2026-11-13T00:00:00+08:00", "HSINCHU_MCP_BLACKOUT_END": "2026-11-14T00:00:00+08:00"})
    assert call(s2, "list_polls", {})["error"]["code"] == "BLACKOUT"


def test_unverified_poll_numbers_never_exposed(view):
    polls = call(mk(view), "list_polls", {})["polls"]
    byt = {p["title"]: p for p in polls}
    assert byt["已核對民調"]["support"] == {"xu": 40.0} and byt["已核對民調"]["source_url"]
    assert "support" not in byt["未核對報導"] and "moe" not in byt["未核對報導"]
    pts = call(mk(view), "get_poll_trend", {"race": "county_magistrate"})["points"]
    assert [p["title"] for p in pts] == ["已核對民調"]
    assert call(mk(view), "get_poll_trend", {"race": "zhubei_mayor"})["points"] == []   # 無資料＝空陣列


def test_policies_need_source_and_stances_show_unknown_honestly(view):
    pol = call(mk(view), "list_policies", {})["policies"]
    assert [p["id"] for p in pol] == ["w001"]
    assert call(mk(view), "get_policy", {"id": "w002"})["error"]["code"] == "NOT_FOUND"
    iss = call(mk(view), "get_issue", {"id": "transport"})["issue"]
    assert iss["stances"]["wu"]["source_url"] and iss["stances"]["xu"]["found"] is False
    assert "未知" in iss["stances"]["xu"]["note"] and "summary" not in iss["stances"]["xu"]


def test_sources_exclude_mixed_item_rows_and_show_platform_limits(view):
    src = call(mk(view), "list_sources", {})["sources"]
    ids = {s["id"] for s in src}
    assert "zz" not in ids and "ptt" in ids and "cna" in ids and "outlet:測試報" in ids
    assert next(s for s in src if s["id"] == "ptt")["status"] == "disabled"
    assert call(mk(view), "get_source", {"id": "nope"})["error"]["code"] == "NOT_FOUND"


def test_stats_and_manifest_hide_pending_and_excluded(view):
    st = call(mk(view), "get_stats")["stats"]
    assert "pending_review_count" not in st
    m = call(mk(view), "get_manifest", {"verify_files": True})
    assert "excluded" not in m["manifest"]["counts"] and "pending_review" not in m["manifest"]["counts"]
    assert "not_shown_total" not in m["manifest"]["counts"]
    assert m["mismatches"] and m["mismatches"][0]["name"] == "items.json"      # 偽 hash 被偵測
    assert call(mk(view), "get_release")["manifest"]["content_sha"] == SHA


def test_event_seq_incremental_when_store_given(view, tmp_path):
    from hourly import batch as hb
    from hourly.store import Store
    d, st = tmp_path / "d", Store(tmp_path / "s")
    fx.write_data(d, [{**fx.item(1), "id": "s001"}, {**fx.item(2), "id": "s002"}])
    hb.ingest(d, st, {})
    s = mk(view, store=st)
    r = call(s, "search_items", {"sort": "event_seq", "limit": 10})
    assert [i["id"] for i in r["items"]] == ["s001", "s002"]
    r2 = call(s, "search_items", {"sort": "event_seq", "after_seq": 1})
    assert [i["id"] for i in r2["items"]] == ["s002"]
    assert call(mk(view), "search_items", {"after_seq": 1})["error"]["code"] == "INVALID_ARGUMENT"   # 無 store 不假裝有序號


def test_size_cap_truncates(view, tmp_path):
    v = tmp_path / "big"
    write_view(v)
    items = [_item(i, summary="字" * 300, title="t" * 3000) for i in range(1, 100)]
    for i, it in enumerate(items):
        it["id"] = f"b{i}"
    (v / "items.json").write_text(json.dumps(items, ensure_ascii=False))
    r = call(mk(v), "search_items", {"limit": 100})
    assert len(json.dumps(r["items"], ensure_ascii=False)) <= mcp_site.MAX_BYTES and r.get("truncated") is True


# ---------------------------------------------------------------- HTTP（Gemini 風格用戶端）
class Client:
    """模擬 Gemini CLI（MCP TS SDK StreamableHTTPClientTransport）的請求形狀：Accept 兩種、MCP-Protocol-Version、Bearer。"""

    def __init__(self, port, token=None, origin=None, host=None):
        self.port, self.token, self.origin, self.host = port, token, origin, host

    def post(self, body, proto=None, raw=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if self.origin:
            h["Origin"] = self.origin
        if proto:
            h["MCP-Protocol-Version"] = proto
        if self.host:
            h["Host"] = self.host
        c.request("POST", "/mcp", raw if raw is not None else json.dumps(body), h)
        r = c.getresponse()
        data = r.read()
        hdrs = {k.lower(): v for k, v in r.getheaders()}
        c.close()
        return r.status, hdrs, (json.loads(data) if data else None)

    def request(self, method, path="/mcp", extra=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = dict(extra or {})
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        c.request(method, path, headers=h)
        r = c.getresponse()
        r.read()
        out = (r.status, {k.lower(): v for k, v in r.getheaders()})
        c.close()
        return out


def start(view, **kw):
    srv = mcp_http.create_server(mk(view), "127.0.0.1", 0, **kw)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv, srv.server_address[1]


def test_http_gemini_style_flow_lists_and_calls_tools(view):
    srv, port = start(view, token="test-token-not-secret")
    try:
        c = Client(port, "test-token-not-secret")
        st, h, init = c.post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "gemini-cli", "version": "0"}}})
        assert st == 200 and init["result"]["serverInfo"]["name"] == "hsinchu-watch-site"
        assert "access-control-allow-origin" not in h and h["content-type"].startswith("application/json")
        assert c.post({"jsonrpc": "2.0", "method": "notifications/initialized"}, proto="2025-06-18")[0] == 202
        st, _, tl = c.post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, proto="2025-06-18")
        names = {t["name"] for t in tl["result"]["tools"]}
        assert {"search_items", "list_polls", "list_policies", "get_manifest", "list_sources", "get_stats", "list_people"} <= names
        for t in tl["result"]["tools"]:
            assert t["inputSchema"]["type"] == "object" and t["annotations"]["readOnlyHint"] is True
        st, _, call_r = c.post({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                "params": {"name": "search_items", "arguments": {"person": "wu", "limit": 2}}}, proto="2025-06-18")
        sc = call_r["result"]["structuredContent"]
        assert len(sc["items"]) == 2 and sc["data_version"]["content_sha"] == SHA
        txt = json.loads(call_r["result"]["content"][0]["text"])
        assert txt["total"] == 7
        st, _, batch = c.post([{"jsonrpc": "2.0", "id": 4, "method": "ping"}, {"jsonrpc": "2.0", "id": 5, "method": "tools/list"}])
        assert [b["id"] for b in batch] == [4, 5]
    finally:
        srv.shutdown()


def test_http_auth_required_and_token_never_in_responses(view):
    srv, port = start(view, token="s3cret-token-value")
    try:
        body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
        st, h, _ = Client(port, None).post(body)
        assert st == 401 and "bearer" in h["www-authenticate"].lower()
        assert Client(port, "wrong").post(body)[0] == 401
        assert Client(port, "s3cret-token-value").post(body)[0] == 200
        assert Client(port).request("GET", "/healthz")[0] == 200
    finally:
        srv.shutdown()


def test_http_rate_limit_429_with_retry_after(view):
    srv, port = start(view, token="t", per_minute=60, burst=3)
    try:
        c = Client(port, "t")
        codes = [c.post({"jsonrpc": "2.0", "id": i, "method": "ping"})[0] for i in range(6)]
        assert codes[:3] == [200, 200, 200] and 429 in codes
        st, h, _ = c.post({"jsonrpc": "2.0", "id": 9, "method": "ping"})
        assert st == 429 and int(h["retry-after"]) >= 1
        # 另一個 token 不受影響（各用戶端獨立）
    finally:
        srv.shutdown()


def test_rate_limiter_refills_with_clock():
    t = [0.0]
    rl = mcp_http.RateLimiter(per_minute=60, burst=2, clock=lambda: t[0])
    assert rl.allow("k")[0] and rl.allow("k")[0] and not rl.allow("k")[0]
    t[0] += 1.0
    assert rl.allow("k")[0]


def test_http_cors_off_by_default_and_origin_rejected(view):
    srv, port = start(view)
    try:
        c = Client(port, origin="https://evil.example")
        st, h, _ = c.post({"jsonrpc": "2.0", "id": 1, "method": "ping"})
        assert st == 403 and "access-control-allow-origin" not in h
        assert Client(port).request("OPTIONS", extra={"Origin": "https://evil.example"})[0] == 403
        assert Client(port, host="evil.example").post({"jsonrpc": "2.0", "id": 1, "method": "ping"})[0] == 403   # DNS rebinding
        assert Client(port).post({"jsonrpc": "2.0", "id": 1, "method": "ping"})[0] == 200                       # 無 Origin（CLI）可
    finally:
        srv.shutdown()
    srv, port = start(view, allowed_origins=("http://localhost:3000",))
    try:
        st, h, _ = Client(port, origin="http://localhost:3000").post({"jsonrpc": "2.0", "id": 1, "method": "ping"})
        assert st == 200 and h["access-control-allow-origin"] == "http://localhost:3000"
    finally:
        srv.shutdown()


def test_http_protocol_edges(view):
    srv, port = start(view)
    try:
        c = Client(port)
        assert c.request("GET")[0] == 405 and c.request("DELETE")[0] == 405
        assert c.post({"jsonrpc": "2.0", "id": 1, "method": "ping"}, proto="1999-01-01")[0] == 400
        assert c.post(None, raw="{not json")[0] == 400
        assert c.post(None, raw="x" * 70000)[0] == 413
        assert c.post({"jsonrpc": "2.0", "id": 1, "method": "nope"})[2]["error"]["code"] == -32601
        assert c.request("POST", "/other")[0] in (404, 400)
    finally:
        srv.shutdown()


def test_http_refuses_non_loopback_bind(view):
    for host in ("0.0.0.0", "192.168.1.5", "example.com", "::"):
        with pytest.raises(ValueError):
            mcp_http.create_server(mk(view), host, 0)


def test_cli_refuses_collector_data_dir_and_missing_token(tmp_path, capsys):
    repo = tmp_path / "r"
    (repo / "collectors").mkdir(parents=True)
    (repo / "data").mkdir()
    (repo / "data" / "manifest.json").write_text("{}")
    assert mcp_http.main(["--view-dir", str(repo / "data"), "--port", "0"]) == 2
    assert mcp_site.main(["--view-dir", str(repo / "data")]) == 2
    import os
    os.environ.pop("HSINCHU_MCP_TOKEN", None)
    assert mcp_http.main(["--require-token", "--view-dir", str(repo / "data")]) == 2


def test_no_token_literal_committed():
    root = Path(__file__).resolve().parents[1]
    import re
    for f in list((root / "hourly").glob("*.py")) + list((root / "docs").glob("**/*.md") if (root / "docs").exists() else []):
        s = f.read_text(encoding="utf-8")
        assert not re.search(r"Bearer\s+[A-Za-z0-9_\-]{20,}", s), f.name
