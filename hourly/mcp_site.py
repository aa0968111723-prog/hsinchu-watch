# -*- coding: utf-8 -*-
"""網站唯讀 MCP（工具契約＝work/全端工程師/SITE_MCP_SPEC.md；stdio 與 Streamable HTTP 共用）。

資料來源：已上架視圖（public/data、dist/data，或 `python -m hourly.site_view` 由 data/ 經 finalize 產生）。
絕不讀 excluded／pending／review_decisions／excluded_urls.local.json；視圖目錄含這些檔會拒絕啟動。
12 個規格工具 + get_release 別名 + list_stances / get_issue。回應一律帶 data_version；錯誤碼
NOT_FOUND / INVALID_ARGUMENT / DATA_STALE / BLACKOUT。
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import classify
from .mcp_stdio import Server, Tool
from .site_view import ViewError, check_view_dir

TZ = timezone(timedelta(hours=8))
PERSONS = ("wu", "xu", "zheng", "chiu", "chen", "wuzijia")
STALE_MINUTES = 90
MAX_LIMIT = 100
MAX_BYTES = 256 * 1024
SUMMARY_MAX = 400
STRIP_KEYS = {k.lower() for k in (
    "author", "author_name", "author_id", "username", "user_name", "user_id", "account", "account_name", "account_id",
    "handle", "screen_name", "display_name", "avatar", "avatar_url", "profile_url", "profile_image", "user", "poster",
    "poster_name", "commenter", "commenter_name", "commenter_id", "from", "owner", "inbox_account", "inbox_note",
    "x_status_id", "profile_link", "restored_from", "discovered_via", "media_search_id", "html_source_id", "feed_id",
    "curated_from", "curated", "inbox_added_at", "inbox_note", "resolved_from", "low_local_to_pending", "filter_reason")}
HIDDEN_COUNT_KEYS = ("excluded", "excluded_collect", "excluded_publish", "pending_review", "pending_review_publish",
                     "not_shown_total", "counts_note")


class McpError(Exception):
    def __init__(self, code: str, message: str, extra: Optional[dict] = None):
        super().__init__(message)
        self.code, self.message, self.extra = code, message, extra or {}


def _ok_url(u: Any) -> bool:
    return isinstance(u, str) and re.match(r"^https?://[^\s]+$", u.strip()) is not None


def scrub(o: Any) -> Any:
    """遞迴剔除留言者／帳號類鍵。"""
    if isinstance(o, dict):
        return {k: scrub(v) for k, v in o.items() if k.lower() not in STRIP_KEYS}
    if isinstance(o, list):
        return [scrub(v) for v in o]
    return o


def _parse_day(s: str, end: bool = False) -> datetime:
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            d = datetime.fromisoformat(s).replace(tzinfo=TZ)
            return d + timedelta(days=1) if end else d
        d = datetime.fromisoformat(s)
        return d if d.tzinfo else d.replace(tzinfo=TZ)
    except ValueError:
        raise McpError("INVALID_ARGUMENT", f"日期格式無法解析：{s}")


def _ts(s: Any) -> Optional[datetime]:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s))
        return d if d.tzinfo else d.replace(tzinfo=TZ)
    except ValueError:
        return None


class SiteData:
    def __init__(self, view_dir: Path, *, store=None, now=None, env=None):
        self.dir = check_view_dir(view_dir)
        self.store = store
        self.now = now or (lambda: datetime.now(TZ))
        self.env = os.environ if env is None else env
        self._c: Dict[str, Any] = {}

    def j(self, name: str, default: Any = None) -> Any:
        if name not in self._c:
            p = self.dir / f"{name}.json"
            self._c[name] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else default
        return self._c[name]

    # ---- 版本
    def manifest(self) -> dict:
        m = self.j("manifest")
        if not m:
            raise McpError("NOT_FOUND", "缺 manifest.json")
        return m

    def data_version(self) -> dict:
        m, st = self.manifest(), self.j("stats", {}) or {}
        gen = m.get("generated_at") or st.get("generated_at")
        t = _ts(gen)
        age = round((self.now() - t).total_seconds() / 60, 1) if t else None
        return {"content_sha": m.get("content_sha"), "generated_at": gen, "finalized_at": m.get("finalized_at"),
                "timezone": "Asia/Taipei", "stale": age is None or age > STALE_MINUTES, "age_minutes": age,
                "stale_after_minutes": STALE_MINUTES}

    def blackout(self) -> Optional[dict]:
        st = (self.j("stats", {}) or {}).get("poll_blackout") or {}
        s = self.env.get("HSINCHU_MCP_BLACKOUT_START") or st.get("start") or "2026-11-18T00:00:00+08:00"
        e = self.env.get("HSINCHU_MCP_BLACKOUT_END") or st.get("end") or "2026-11-28T16:00:00+08:00"
        n = self.now()
        if _ts(s) <= n < _ts(e):  # 只由設定／環境變數決定；公開工具沒有覆寫旗標
            return {"start": s, "end": e}
        return None

    # ---- 項目
    def items(self) -> List[dict]:
        if "_items" not in self._c:
            seq = {}
            if self.store is not None:
                seq = self.store.state_at()["item_rev"]
            out = []
            for it in self.j("items", []) or []:
                if not (_ok_url(it.get("url")) and str(it.get("source_name") or "").strip()):
                    continue
                if it.get("person_id") not in PERSONS:
                    continue
                c = scrub(it)
                c["source_url"] = c["url"]
                if isinstance(c.get("summary"), str) and len(c["summary"]) > SUMMARY_MAX:
                    c["summary"], c["truncated"] = c["summary"][:SUMMARY_MAX], True
                if "engagement" not in c:
                    c["engagement"] = None  # 未知＝null，不是 0
                c["layer"] = classify.classify_layer(it)[0]
                c["layer_note"] = "分層為關鍵字啟發式，不是查核結論"
                if self.store is not None:
                    c["event_seq"] = seq.get(it.get("id"))
                out.append(c)
            self._c["_items"] = out
        return self._c["_items"]


def build(data: SiteData) -> Server:
    def ver():
        return data.data_version()

    def wrap(fn):
        def inner(a: dict):
            v = ver()
            try:
                if v["stale"] and str(data.env.get("HSINCHU_MCP_STALE_ERROR", "")) in ("1", "true"):
                    raise McpError("DATA_STALE", f"資料已過期（{v['age_minutes']} 分鐘 > {STALE_MINUTES}）")
                out = fn(a)
                out["data_version"] = v
                return _cap(out)
            except McpError as e:
                return {"error": {"code": e.code, "message": e.message, **e.extra}, "data_version": v, "isError": True}
        return inner

    def _cap(out: dict) -> dict:
        for key in ("items", "polls", "policies", "sources", "points"):
            while key in out and len(json.dumps(out[key], ensure_ascii=False)) > MAX_BYTES and len(out[key]) > 1:
                out[key] = out[key][: max(1, len(out[key]) // 2)]
                out["truncated"] = True
        return out

    def limit_of(a: dict) -> int:
        lim = a.get("limit", 30)
        if lim > MAX_LIMIT or lim < 1:
            raise McpError("INVALID_ARGUMENT", f"limit 必須在 1–{MAX_LIMIT}")
        return lim

    sha12 = lambda: (data.manifest().get("content_sha") or "")[:12]  # noqa: E731

    def enc(offset: int) -> str:
        return base64.urlsafe_b64encode(json.dumps({"o": offset, "s": sha12()}).encode()).decode().rstrip("=")

    def dec(c: Optional[str]) -> int:
        if not c:
            return 0
        try:
            d = json.loads(base64.urlsafe_b64decode(c + "=" * (-len(c) % 4)))
            if d["s"] != sha12():
                raise McpError("INVALID_ARGUMENT", "cursor 對應的資料版本已變，請重新查詢")
            return int(d["o"])
        except McpError:
            raise
        except Exception:
            raise McpError("INVALID_ARGUMENT", "cursor 無效")

    def paged(rows: list, a: dict, key: str) -> dict:
        lim, off = limit_of(a), dec(a.get("cursor"))
        nxt = enc(off + lim) if off + lim < len(rows) else None
        return {key: rows[off:off + lim], "total": len(rows), "next_cursor": nxt}

    def person_ok(pid):
        if pid is not None and pid not in PERSONS:
            raise McpError("NOT_FOUND", f"未知人物：{pid}")

    def in_range(ts, a):
        t = _ts(ts)
        if a.get("date_from") and (t is None or t < _parse_day(a["date_from"])):
            return False
        if a.get("date_to") and (t is None or t >= _parse_day(a["date_to"], True)):
            return False
        return True

    def qmatch(q, *fields):
        q = q.lower()
        return any(q in str(f or "").lower() for f in fields)

    # ---- people
    def photos():
        return (data.j("candidate_photos", {}) or {}).get("persons", {})

    def list_people(a):
        st = data.j("stats", {}) or {}
        counts: Dict[str, int] = {}
        for it in data.items():
            counts[it["person_id"]] = counts.get(it["person_id"], 0) + 1
        rows = []
        for p in st.get("persons") or []:
            if p.get("id") not in PERSONS:
                continue
            ph = photos().get(p["id"], {})
            r = {"id": p["id"], "name": p.get("name"), "role": p.get("role"), "party": p.get("party"),
                 "photo_url": ph.get("public_url"), "photo_credit": ph.get("credit_zh")}
            if a.get("include_stats", True):
                bp = (st.get("by_person") or {}).get(p["id"], {})
                r.update(total=counts.get(p["id"], 0), last_24h=bp.get("last_24h"), last_7d=bp.get("last_7d"))
            rows.append(r)
        return {"persons": rows, "note": "筆數是上架資料筆數，不是聲量、支持度或民調。"}

    def get_person(a):
        person_ok(a["person"])
        st = data.j("stats", {}) or {}
        meta = next((p for p in st.get("persons") or [] if p.get("id") == a["person"]), None)
        if not meta:
            raise McpError("NOT_FOUND", "此人物不在資料中")
        bp = {k: v for k, v in ((st.get("by_person") or {}).get(a["person"], {})).items() if k != "latest"}
        mine = sorted([i for i in data.items() if i["person_id"] == a["person"]],
                      key=lambda i: str(i.get("published_at") or ""), reverse=True)
        ph = photos().get(a["person"], {})
        off = (data.j("official", {}) or {}).get("by_person", {}).get(a["person"], {})
        p = dict(meta, **bp, latest=mine[:5], total=len(mine), photo_url=ph.get("public_url"),
                 photo_credit=ph.get("credit_zh"), photo_source_url=ph.get("source_url"), photo_license=ph.get("license"),
                 official_count=off.get("count"), source_name="網站資料", source_url=ph.get("source_url"))
        return {"person": scrub(p)}

    # ---- items
    def search_items(a):
        person_ok(a.get("person"))
        rows = data.items()
        if a.get("person"):
            rows = [i for i in rows if i["person_id"] == a["person"]]
        if a.get("platform"):
            rows = [i for i in rows if i.get("platform") == a["platform"]]
        if a.get("kind"):
            rows = [i for i in rows if a["kind"] in (i.get("source_type"), i.get("type"))]
        if "has_image" in a:
            rows = [i for i in rows if bool(i.get("image_url")) == a["has_image"]]
        if "is_own_speech" in a:
            rows = [i for i in rows if bool(i.get("is_own_speech")) == a["is_own_speech"]]
        if a.get("layer"):
            rows = [i for i in rows if i.get("layer") == a["layer"]]
        if a.get("q"):
            rows = [i for i in rows if qmatch(a["q"], i.get("title"), i.get("summary"), i.get("source_name"))]
        rows = [i for i in rows if in_range(i.get("published_at"), a)] if (a.get("date_from") or a.get("date_to")) else rows
        sort = a.get("sort", "published_at")
        if sort == "event_seq" or "after_seq" in a:
            if data.store is None:
                raise McpError("INVALID_ARGUMENT", "此伺服器未啟用事件序號（未提供 --store）")
            rows = [i for i in rows if i.get("event_seq") is not None and i["event_seq"] > a.get("after_seq", 0)]
            rows = sorted(rows, key=lambda i: i["event_seq"])
        else:
            rows = sorted(rows, key=lambda i: str(i.get(sort) or ""), reverse=True)
        return paged(rows, a, "items")

    def get_item(a):
        if not a.get("id") and not a.get("url"):
            raise McpError("INVALID_ARGUMENT", "需要 id 或 url")
        for i in data.items():
            if (a.get("id") and i.get("id") == a["id"]) or (a.get("url") and i.get("url") == a["url"]):
                return {"item": i}
        raise McpError("NOT_FOUND", "找不到此項目（或無來源）")

    # ---- polls
    def poll_row(p):
        if not (_ok_url(p.get("url")) and p.get("source_name")):
            return None
        r = scrub(p)
        r["source_url"] = r["url"]
        if not r.get("verified"):
            for k in ("support", "raw_percents", "moe", "matchups"):
                r.pop(k, None)
        return r

    def polls_list():
        return [r for r in (poll_row(p) for p in data.j("polls", []) or []) if r]

    def guard_blackout():
        b = data.blackout()
        if b:
            raise McpError("BLACKOUT", "民調封閉期間，不提供民調資料", {"blackout": b})

    def list_polls(a):
        guard_blackout()
        person_ok(a.get("person"))
        rows = polls_list()
        if a.get("person"):
            rows = [r for r in rows if a["person"] in (r.get("person_ids") or [])]
        if a.get("race"):
            rows = [r for r in rows if r.get("race") == a["race"]]
        if a.get("verified_only"):
            rows = [r for r in rows if r.get("verified")]
        if a.get("q"):
            rows = [r for r in rows if qmatch(a["q"], r.get("title"), r.get("org"), r.get("source_name"))]
        rows = [r for r in rows if in_range(r.get("published_at"), a)] if (a.get("date_from") or a.get("date_to")) else rows
        rows.sort(key=lambda r: str(r.get("published_at") or ""), reverse=True)
        out = paged(rows, a, "polls")
        out["note"] = "民調數字只在人工核對（verified）時出現；sample_size／moe 缺＝未知，不是 0；聲量與情緒不是民調。"
        return out

    def get_poll_trend(a):
        guard_blackout()
        person_ok(a.get("person"))
        pts = []
        for r in polls_list():
            if not r.get("verified") or r.get("numbers_hidden") or not r.get("support"):
                continue
            if a.get("race") and r.get("race") != a["race"]:
                continue
            if a.get("person") and a["person"] not in (r.get("support") or {}):
                continue
            if not in_range(r.get("published_at"), a):
                continue
            pts.append({k: r.get(k) for k in ("published_at", "source_name", "source_url", "title", "org", "support",
                                               "sample_size", "moe")})
        pts.sort(key=lambda p: str(p.get("published_at") or ""))
        return {"race": a.get("race"), "points": pts}

    # ---- policies
    def policy_row(p):
        if not (_ok_url(p.get("source_url") or p.get("url")) and p.get("source_name")):
            return None
        r = scrub(p)
        r["source_url"] = r.get("source_url") or r.get("url")
        return r

    def policies_list():
        return [r for r in (policy_row(p) for p in data.j("policies", []) or []) if r]

    def list_policies(a):
        person_ok(a.get("person"))
        rows = policies_list()
        if a.get("person"):
            rows = [r for r in rows if r.get("person_id") == a["person"]]
        if a.get("kind"):
            rows = [r for r in rows if r.get("kind") == a["kind"]]
        if "controversy" in a:
            rows = [r for r in rows if bool(r.get("controversy")) == a["controversy"]]
        if a.get("q"):
            rows = [r for r in rows if qmatch(a["q"], r.get("title"), r.get("summary"))]
        rows = [r for r in rows if in_range(r.get("published_at"), a)] if (a.get("date_from") or a.get("date_to")) else rows
        out = paged(rows, a, "policies")
        out["note"] = "政見＝主張（policy）；政績＝官方或本人宣稱（record）。工程完工不等於驗收或成效；未列＝未知，不是沒有。"
        return out

    def get_policy(a):
        for r in policies_list():
            if r.get("id") == a["id"]:
                return {"policy": r}
        raise McpError("NOT_FOUND", "找不到此政見／政績")

    # ---- stances
    def issues():
        return (data.j("issue_stances", {}) or {}).get("issues") or []

    def issue_row(i):
        stances = {}
        for pid, s in (i.get("stances") or {}).items():
            if pid not in PERSONS:
                continue
            if s.get("found") and _ok_url(s.get("source_url")) and s.get("source_name"):
                stances[pid] = scrub(s)
            else:
                stances[pid] = {"found": False, "note": "未找到可附來源的公開主張（未知，不代表沒有立場）"}
        return {"id": i.get("id"), "name": i.get("name"), "blurb": i.get("blurb"), "order": i.get("order"), "stances": stances}

    def list_stances(a):
        rows = [issue_row(i) for i in issues()]
        return paged(rows, dict(a, limit=a.get("limit", 30)), "issues") | {"note": "各人主張並列，不排名、不評分；每則附來源。"}

    def get_issue(a):
        for i in issues():
            if i.get("id") == a["id"]:
                return {"issue": issue_row(i)}
        raise McpError("NOT_FOUND", "找不到此議題")

    # ---- sources
    def sources_all():
        st = data.j("stats", {}) or {}
        rows = []
        for k, v in (st.get("source_stats") or {}).items():
            if isinstance(v, dict):
                status = "disabled" if v.get("disabled") else ("error" if v.get("error") else
                                                              ("skipped" if v.get("skipped_by_schedule") else "ok"))
                rows.append({"id": k, "label": k, "kind": "collector", "status": status,
                             "status_text": str(v.get("disabled") or v.get("error") or v.get("reason") or "")[:120] or None,
                             "count": v.get("ok") if isinstance(v.get("ok"), int) else None})
        for r in st.get("source_status") or []:
            if "title" in r or "url" in r or not (r.get("label") or r.get("id")) or not r.get("status"):
                continue  # source_status 混入的項目列不當來源
            rows.append({"id": r.get("id"), "label": r.get("label") or r.get("id"), "kind": "status", "status": r.get("status"),
                         "status_text": r.get("status_text"), "count": r.get("count")})
        od = (st.get("outlet_distribution") or {}).get("overall")
        if isinstance(od, dict):
            od = od.get("outlets")
        for o in od or []:
            if isinstance(o, dict) and o.get("name"):
                rows.append({"id": f"outlet:{o['name']}", "label": o["name"], "kind": "outlet", "status": "observed",
                             "count": o.get("count")})
        return rows

    def list_sources(a):
        rows = sources_all()
        for k in ("kind", "status"):
            if a.get(k):
                rows = [r for r in rows if r.get(k) == a[k]]
        if a.get("q"):
            rows = [r for r in rows if qmatch(a["q"], r.get("id"), r.get("label"))]
        out = paged(rows, a, "sources")
        out["note"] = "disabled＝robots／平台限制，如實記錄、不繞過；count null＝未知，不是 0。"
        return out

    def get_source(a):
        r = next((x for x in sources_all() if x["id"] == a["id"]), None)
        if not r:
            raise McpError("NOT_FOUND", "找不到此來源")
        out = {"source": dict(r, stats=scrub((data.j("stats", {}) or {}).get("source_stats", {}).get(a["id"])))}
        if a.get("include_items"):
            lim = a.get("limit", 10)
            if lim > MAX_LIMIT:
                raise McpError("INVALID_ARGUMENT", f"limit 必須 ≤ {MAX_LIMIT}")
            out["items"] = [i for i in data.items() if i.get("source_name") == r["label"]][:lim]
        return out

    # ---- manifest / stats
    def manifest_out(a):
        m = data.manifest()
        counts = {k: v for k, v in (m.get("counts") or {}).items() if k not in HIDDEN_COUNT_KEYS}
        out = {"manifest": {"content_sha": m.get("content_sha"), "generated_at": m.get("generated_at"),
                            "finalized_at": m.get("finalized_at"), "timezone": m.get("timezone"),
                            "persons_order": m.get("persons_order"), "poll_blackout_active": m.get("poll_blackout_active"),
                            "counts": counts, "files": m.get("files"), "release": m.get("release")}}
        if a.get("verify_files"):
            mism = []
            for name, meta in (m.get("files") or {}).items():
                p = data.dir / name
                if not p.exists():
                    mism.append({"name": name, "error": "missing_on_disk"})
                    continue
                act = hashlib.sha256(p.read_bytes()).hexdigest()
                exp = meta.get("sha256") if isinstance(meta, dict) else meta
                if exp and exp != act:
                    mism.append({"name": name, "expected_sha256": exp, "actual_sha256": act})
            out["mismatches"] = mism
        return out

    def get_stats(a):
        st = data.j("stats", {}) or {}
        keep = ("total_items", "total_rows", "polls_count", "downrank_count", "count_policy", "disclaimer", "poll_blackout",
                "persons", "timezone")
        s = {k: st.get(k) for k in keep}
        if a.get("include_topics"):
            s["topics"] = st.get("topics")
        s["poll_blackout"] = dict(s.get("poll_blackout") or {}, active=bool(data.blackout()))
        return {"stats": scrub(s), "note": "待審／排除清單與其筆數不經此 MCP 提供（只在代理匯入 MCP，標待審）。"}

    S = lambda props, req=(): {"type": "object", "properties": props, "required": list(req)}  # noqa: E731
    P = {"type": "string", "enum": list(PERSONS)}
    lim = {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT}
    cur = {"type": "string", "maxLength": 200}
    q = {"type": "string", "maxLength": 100}
    dt = {"type": "string", "maxLength": 40}
    T = lambda n, d, s, f: Tool(n, d, s, wrap(f))  # noqa: E731
    tools = [
        T("list_people", "人物清單與上架筆數（非聲量）。", S({"include_stats": {"type": "boolean"}}), list_people),
        T("get_person", "單一人物：統計、來源組成、最新 5 則、肖像出處。", S({"person": P}, ["person"]), get_person),
        T("search_items", "搜尋上架項目（人物／平台／分層／日期／關鍵字；cursor 分頁；有 --store 時可依 event_seq 增量）。",
          S({"person": P, "platform": {"type": "string", "maxLength": 30}, "kind": {"type": "string", "maxLength": 30},
             "layer": {"type": "string", "enum": list(classify.LAYERS)}, "has_image": {"type": "boolean"},
             "is_own_speech": {"type": "boolean"}, "q": q, "date_from": dt, "date_to": dt,
             "sort": {"type": "string", "enum": ["published_at", "collected_at", "event_seq"]},
             "after_seq": {"type": "integer", "minimum": 0}, "limit": lim, "cursor": cur}), search_items),
        T("get_item", "以 id 或 url 取單則項目。", S({"id": {"type": "string", "maxLength": 64}, "url": {"type": "string", "maxLength": 500}}), get_item),
        T("list_polls", "民調列表（封閉期整工具回 BLACKOUT）。",
          S({"person": P, "race": {"type": "string", "enum": ["county_magistrate", "zhubei_mayor"]},
             "verified_only": {"type": "boolean"}, "q": q, "date_from": dt, "date_to": dt, "limit": lim, "cursor": cur}), list_polls),
        T("get_poll_trend", "已核對民調的時間序列（封閉期 BLACKOUT）。",
          S({"person": P, "race": {"type": "string", "maxLength": 30}, "date_from": dt, "date_to": dt}), get_poll_trend),
        T("list_policies", "政見(policy)／政績(record)列表。",
          S({"person": P, "kind": {"type": "string", "enum": ["policy", "record"]}, "controversy": {"type": "boolean"},
             "q": q, "date_from": dt, "date_to": dt, "limit": lim, "cursor": cur}), list_policies),
        T("get_policy", "以政策 id 取單則。", S({"id": {"type": "string", "maxLength": 32}}, ["id"]), get_policy),
        T("list_stances", "議題立場比較（各人並列、每則附來源）。", S({"limit": lim, "cursor": cur}), list_stances),
        T("get_issue", "單一議題的各人立場。", S({"id": {"type": "string", "maxLength": 32}}, ["id"]), get_issue),
        T("list_sources", "來源清單（蒐集器／狀態／媒體）；平台限制如實標示。",
          S({"kind": {"type": "string", "enum": ["collector", "status", "outlet"]}, "status": {"type": "string", "maxLength": 30},
             "q": q, "limit": lim, "cursor": cur}), list_sources),
        T("get_source", "單一來源詳情與可選最近項目。",
          S({"id": {"type": "string", "maxLength": 80}, "include_items": {"type": "boolean"}, "limit": lim}, ["id"]), get_source),
        T("get_manifest", "release／資料雜湊／時間／筆數；verify_files 可核對視圖實檔。",
          S({"verify_files": {"type": "boolean"}}), manifest_out),
        T("get_release", "get_manifest 的別名。", S({"verify_files": {"type": "boolean"}}), manifest_out),
        T("get_stats", "全站統計（不含待審／排除）。", S({"include_topics": {"type": "boolean"}}), get_stats),
    ]
    return Server("hsinchu-watch-site", "0.2.0", tools,
                  "唯讀；只讀已上架視圖；不含待審／排除；不發布、不寫檔。")


def open_data(view_dir: str, store_dir: Optional[str] = None) -> SiteData:
    store = None
    if store_dir:
        from .store import Store
        store = Store(store_dir, create=False)
    return SiteData(Path(view_dir), store=store)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--view-dir", default=os.environ.get("HSINCHU_MCP_VIEW_DIR", "public/data"))
    ap.add_argument("--store", help="可選：hourly store（啟用 event_seq 增量）")
    ns = ap.parse_args(argv)
    try:
        srv = build(open_data(ns.view_dir, ns.store))
    except ViewError as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    srv.serve()
    return 0


if __name__ == "__main__":
    sys.exit(main())
