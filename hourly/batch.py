# -*- coding: utf-8 -*-
"""每小時不可變批次：從 data/ 讀（唯讀）→ 差異 → 批次 manifest + 事件 + 更正／排除帳。

規則
- 新資料一律「待審」，程式永不標「已查核」。
- 增量：只記 delta；人工更正、排除清單、更正歷史只增不改（append-only）。
- 冪等：資料內容未變 → noop，不產生新批次／事件／seq。
- 失敗：保留 HEAD（最後成功資料），寫 health 失敗紀錄；MCP status 顯示過期與覆蓋缺口。
- 崩潰安全：批次檔（含事件列）先原子寫入；事件以 event_key 去重補寫；最後才更新 HEAD。
"""
from __future__ import annotations

import subprocess
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from . import classify
from .store import Store
from .util import canon, now_iso, read_json, sha256_file, sha256_obj

SKIP_DATA_FILES = {"excluded_urls.local.json"}  # 含原始個人頁網址，不讀、不雜湊、不入庫
DROP_THRESHOLD = 0.5
LIVE_URL = "https://hsinchu-watch.pages.dev"


class IngestError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


# ---- 環境脈絡（可注入；預設唯讀 git／唯讀 HTTP GET）
def _git(repo: Path, *a: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True, timeout=60).stdout.strip()


def real_context(repo: Path, live_url: str = LIVE_URL) -> Dict[str, Any]:
    ctx: Dict[str, Any] = {"source_commit": _git(repo, "rev-parse", "HEAD"),
                           "source_tree_dirty": bool(_git(repo, "status", "--porcelain", "--", "data"))}
    ls = _git(repo, "ls-remote", "origin", "refs/heads/main")
    ctx["base_main_commit"] = ls.split()[0] if ls else None
    try:
        raw = urllib.request.urlopen(live_url + "/data/manifest.json", timeout=20).read()
        m = __import__("json").loads(raw)
        ctx["live_manifest_hash"] = __import__("hashlib").sha256(raw).hexdigest()
        ctx["base_live_release"] = (m.get("release") or {}).get("id")
        ctx["live_data_sha256"] = (m.get("release") or {}).get("data_sha256") or m.get("content_sha")
        ctx["base_live_finalized_at"] = m.get("finalized_at")
    except Exception as e:  # 唯讀讀取失敗：如實記錄，不中止蒐集批次
        ctx.update(live_manifest_hash=None, base_live_release=None, live_data_sha256=None, base_live_finalized_at=None,
                   live_manifest_error=str(e)[:200])
    return ctx


def _file_hashes(data_dir: Path) -> Dict[str, str]:
    out = {}
    for f in sorted(data_dir.glob("*.json")):
        if f.name in SKIP_DATA_FILES:
            continue
        out[f.name] = sha256_file(f)
    return out


def _load_items(data_dir: Path) -> List[dict]:
    items = read_json(data_dir / "items.json")
    if not isinstance(items, list) or not items:
        raise IngestError("items_unreadable_or_empty", "data/items.json")
    bad = [i for i in items if not isinstance(i, dict) or not i.get("id") or not i.get("url")]
    if bad:
        raise IngestError("items_missing_id_or_url", f"{len(bad)} rows")
    return items


def build_state(items: List[dict]) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    for it in items:
        proj = classify.project_item(it)
        out[it["id"]] = {"proj": proj, "hash": sha256_obj(classify.hash_view(proj))}
    return out


def _exclusion_refs(data_dir: Path) -> List[dict]:
    refs = []
    for fname, src in (("excluded.json", "collect"), ("excluded_publish.json", "publish")):
        x = read_json(data_dir / fname) or {}
        for sect, kind in (("excluded", "excluded"), ("pending_review", "pending_review")):
            for e in x.get(sect) or []:
                if not isinstance(e, dict) or not (e.get("id") or e.get("url")):
                    continue
                refs.append({"ref": e.get("id") or e.get("url"), "reason": f"{kind}:{e.get('reason')}",
                             "source": f"{fname}/{src}"})
    return refs


def ingest(data_dir: Path | str, store: Store, ctx: Dict[str, Any], *, built_by: str = "hourly-line5") -> Dict[str, Any]:
    """回傳 {status: created|noop|failed, ...}。失敗不改 HEAD。"""
    data_dir = Path(data_dir)
    with store.lock:
        recover(store)
        try:
            return _ingest_locked(data_dir, store, ctx, built_by)
        except IngestError as e:
            store.record_health({"kind": "ingest", "ok": False, "code": e.code, "detail": e.detail[:300],
                                 "head": store.head()})
            return {"status": "failed", "code": e.code, "detail": e.detail, "kept_head": store.head()}
        except Exception as e:  # 任何未預期錯誤 → 同樣保留最後成功資料
            store.record_health({"kind": "ingest", "ok": False, "code": "unexpected",
                                 "detail": f"{type(e).__name__}: {e}"[:300], "head": store.head()})
            return {"status": "failed", "code": "unexpected", "detail": str(e), "kept_head": store.head()}


def _ingest_locked(data_dir: Path, store: Store, ctx: Dict[str, Any], built_by: str) -> Dict[str, Any]:
    items = _load_items(data_dir)
    cur = build_state(items)
    prev = store.state_at()
    prev_items: Dict[str, str] = prev["items"]
    if prev_items and len(cur) < len(prev_items) * DROP_THRESHOLD:
        raise IngestError("suspicious_drop", f"{len(prev_items)}->{len(cur)} (<{DROP_THRESHOLD:.0%})")

    events: List[dict] = []
    pending_objs: Dict[str, dict] = {}
    for iid, c in cur.items():
        if iid not in prev_items:
            t = "item_added"
        elif prev_items[iid] != c["hash"]:
            t = "item_changed"
        else:
            continue
        pending_objs[c["hash"]] = c["proj"]
        events.append({"event_key": f"{c['hash']}:{iid}:{t}", "type": t, "item_id": iid, "hash": c["hash"],
                       "prev_hash": prev_items.get(iid), "person_id": c["proj"].get("person_id"),
                       "layer": c["proj"].get("layer"), "verification": "待審"})
    for iid, h in prev_items.items():
        if iid not in cur:
            events.append({"event_key": f"{h}:{iid}:item_withdrawn", "type": "item_withdrawn", "item_id": iid,
                           "hash": h, "reason": "missing_from_source"})

    # 排除清單／人工裁決：帳只增不改
    have_keys = {e["key"] for e in store.exclusions()}
    new_excl, seen = [], set()
    for r in _exclusion_refs(data_dir):
        k = f"{r['ref']}:{r['reason']}"
        if k not in have_keys and k not in seen:
            seen.add(k)
            new_excl.append(r)
    rd = read_json(data_dir / "review_decisions.json") or {}
    decisions = rd.get("decisions") or {}

    file_hashes = _file_hashes(data_dir)
    # 判斷是否有任何實質變化（含排除／裁決新增）
    known_corr = {c["key"] for c in store.corrections()}
    corr_candidates = []
    for iid, d in decisions.items():
        key = f"review:{iid}:{d.get('decision')}:{d.get('verified_at') or d.get('decided_at') or ''}"
        if key not in known_corr:
            corr_candidates.append((iid, d, key))
    new_excl_keys = new_excl

    if not events and not corr_candidates and not new_excl_keys and store.head():
        store.record_health({"kind": "ingest", "ok": True, "noop": True, "head": store.head(),
                             "source_commit": ctx.get("source_commit")})
        return {"status": "noop", "head": store.head(), "revision": store.get_batch(store.head())["revision"]}

    head_b = store.get_batch(store.head()) if store.head() else None
    revision = (head_b["revision"] if head_b else 0) + 1
    state_items = dict(prev_items)
    for ev in events:
        if ev["type"] == "item_withdrawn":
            state_items.pop(ev["item_id"], None)
        else:
            state_items[ev["item_id"]] = ev["hash"]
    state_sha = sha256_obj(sorted(state_items.items()))
    batch_id = f"b{revision:06d}-{state_sha[:10]}"

    src_stats = (read_json(data_dir / "stats.json") or {}).get("source_stats") or {}
    health = source_health_from_stats(src_stats)
    batch = {
        "schema": "hourly-batch/1",
        "batch_id": batch_id,
        "revision": revision,                      # 資料 revision（每個實質批次 +1）
        "state_sha": state_sha,                    # 套用本批後整體狀態（id→hash）雜湊
        "prev_batch_id": head_b["batch_id"] if head_b else None,
        "created_at": now_iso(),
        "built_by": built_by,
        "source_commit": ctx.get("source_commit"),
        "source_tree_dirty": ctx.get("source_tree_dirty"),
        "base_main_commit": ctx.get("base_main_commit"),
        "base_live_release": ctx.get("base_live_release"),
        "live_manifest_hash": ctx.get("live_manifest_hash"),
        "live_data_sha256": ctx.get("live_data_sha256"),
        "base_live_finalized_at": ctx.get("base_live_finalized_at"),
        "base_event_seq": store.head_seq(),        # 本批建立時的事件序號基準
        "corr_seq_after": max([c["corr_seq"] for c in store.corrections()] or [0]) + len(corr_candidates),
        "excl_seq_after": max([c["excl_seq"] for c in store.exclusions()] or [0]) + len(new_excl_keys),
        "live_manifest_error": ctx.get("live_manifest_error"),
        "file_hashes": file_hashes,
        "counts": {"added": sum(e["type"] == "item_added" for e in events),
                   "changed": sum(e["type"] == "item_changed" for e in events),
                   "withdrawn": sum(e["type"] == "item_withdrawn" for e in events),
                   "new_corrections": len(corr_candidates), "new_exclusions": len(new_excl_keys),
                   "total_items_after": len(state_items), "pending_review": len(state_items)},
        "review_policy": "all_new_items_pending_review; never auto 已查核",
        "source_health": health,
        "events": events,
        "new_exclusions": new_excl_keys,
        "new_review_decisions": [k for _, _, k in corr_candidates],
    }
    # 1) 物件（內容定址、不覆寫）
    for h, proj in pending_objs.items():
        store.put_object(proj)
    # 2) 批次檔（不可變，含事件列供崩潰補寫）
    from .util import atomic_write_bytes
    atomic_write_bytes(store.p("batches", batch_id + ".json"), canon(batch), immutable=True)
    # 3) 帳（只增）
    for r in new_excl_keys:
        store.add_exclusion(r["ref"], r["reason"], r["source"])
    for iid, d, key in corr_candidates:
        store.add_correction(iid, "verification", d.get("decision"), d.get("reason") or d.get("code") or "",
                             "review_decisions.json(human)", key=key, kind="review_decision")
    # 4) 事件 → 5) HEAD
    store.append_events([dict(e, batch_id=batch_id, at=batch["created_at"]) for e in events])
    store.set_head(batch_id)
    store.record_health({"kind": "ingest", "ok": True, "batch_id": batch_id, "revision": revision,
                         "counts": batch["counts"], "source_health": health})
    return {"status": "created", "batch_id": batch_id, "revision": revision, "counts": batch["counts"],
            "head_seq": store.head_seq()}


def recover(store: Store) -> Optional[str]:
    """若最後一個批次檔寫入但 HEAD／事件未完成（崩潰），補寫（冪等）。回傳補齊的 batch_id。"""
    batches = store.list_batches()
    if not batches:
        return None
    last = batches[-1]
    if store.head() == last["batch_id"]:
        return None
    store.append_events([dict(e, batch_id=last["batch_id"], at=last["created_at"]) for e in last["events"]])
    store.set_head(last["batch_id"])
    return last["batch_id"]


def source_health_from_stats(src_stats: Dict[str, Any]) -> Dict[str, Any]:
    """來源健康：ok／disabled(平台限制)／error／skipped。平台限制如實記錄，不繞過。"""
    out: Dict[str, Any] = {}
    for name, s in (src_stats or {}).items():
        if not isinstance(s, dict):
            continue
        status = "ok"
        note = None
        if s.get("disabled"):
            status, note = "disabled_platform_limit", str(s["disabled"])
        elif s.get("error"):
            status, note = "error", str(s["error"])[:200]
        elif s.get("skipped_by_schedule"):
            status, note = "skipped_by_schedule", s.get("reason")
        out[name] = {"status": status, "ok_count": s.get("ok") if isinstance(s.get("ok"), int) else None,
                     "note": note}
    return out
