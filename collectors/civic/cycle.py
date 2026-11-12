"""One civic collection cycle: dedupe, backoff, and keep the last good records."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path

from collectors.civic.catalog import GRAPH, GAPS, SOURCES
from collectors.civic.parsers import PARSERS
from collectors.civic.textutil import TZ, now_iso

STALE_AFTER_MINUTES = 90
LOG_LIMIT = 200


def record_id(source_id: str, url: str, native_id: str) -> str:
    raw = f"{source_id}|{native_id}|{url}"
    return "rec-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def fingerprint(record: dict) -> str:
    return json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_hash(records: list[dict]) -> str:
    blob = json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def civic_dir(root: Path) -> Path:
    return root / "public" / "data" / "civic"


def _load(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _dump(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TZ)
    return parsed


def _due(state: dict, now: datetime, force: bool) -> bool:
    if force:
        return True
    nxt = _parse_iso(state.get("next_due_at"))
    return nxt is None or nxt <= now


def _backoff_minutes(interval: int, failures: int) -> int:
    return min(interval * (2 ** min(failures, 4)), 360)


def _public_source(spec: dict, state: dict) -> dict:
    return {
        "id": spec["id"],
        "name": spec["name"],
        "kind": spec["kind"],
        "url": spec.get("url"),
        "list_url": spec.get("list_url"),
        "region_ids": spec.get("region_ids") or [],
        "office_id": spec.get("office_id"),
        "access_method": spec["access_method"],
        "permission": spec.get("permission"),
        "coverage_note": spec.get("coverage_note"),
        "interval_minutes": spec.get("interval_minutes"),
        "date_field": spec.get("date_field"),
        "gap": spec.get("gap"),
        "last_attempt_at": state.get("last_attempt_at"),
        "last_success_at": state.get("last_success_at"),
        "next_due_at": state.get("next_due_at"),
        "health": state.get("health") or ("gap" if spec["access_method"] == "unavailable" else "unknown"),
        "error": state.get("error"),
        "last_http_status": state.get("last_http_status"),
        "consecutive_failures": state.get("consecutive_failures") or 0,
        "records_kept": state.get("records_kept") or 0,
    }


def _finish_record(spec: dict, row: dict, when: str) -> dict:
    office = spec.get("office_id")
    actors = [{"id": office, "kind": "agency"}] if office else []
    return {
        "id": record_id(spec["id"], row["source_url"], row.get("native_id") or ""),
        "kind": row["kind"],
        "source_id": spec["id"],
        "source_url": row["source_url"],
        "title": row["title"],
        "published_at": row.get("published_at"),
        "collected_at": when,
        "checked_at": when,
        "date_precision": row.get("date_precision"),
        "actor_refs": actors,
        "region_refs": row.get("region_refs") or [],
        "text_excerpt": row.get("text_excerpt") or row["title"],
        "claim_origin": row["claim_origin"],
        "verification_status": "unreviewed",
        "stats_eligible": False,
        "native_id": row.get("native_id") or None,
        "data_class": row.get("data_class"),
    }


def _sort_records(records: list[dict]) -> list[dict]:
    return sorted(records, key=lambda row: (row["source_id"], row.get("published_at") or "", row["id"]))


def render_matrix(sources: list[dict], generated_at: str) -> str:
    lines = [
        "# 公開來源矩陣",
        "",
        f"產生時間：{generated_at}。健康狀態來自最近一輪蒐集。未接通的平台列在後半，沒有假裝已經抓到。",
        "",
        "| 來源 | 方法 | 頻率（分） | 日期欄位 | 最後嘗試 | 最後成功 | 下次 | 健康 | 缺口 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for source in sources:
        lines.append("| {name} | {method} | {interval} | {date_field} | {attempt} | {success} | {due} | {health} | {gap} |".format(
            name=source["name"],
            method=source["access_method"],
            interval=source["interval_minutes"] if source["interval_minutes"] is not None else "—",
            date_field=source.get("date_field") or "—",
            attempt=source.get("last_attempt_at") or "—",
            success=source.get("last_success_at") or "—",
            due=source.get("next_due_at") or "—",
            health=source.get("health") or "—",
            gap=(source.get("gap") or source.get("error") or "—").replace("|", "/"),
        ))
    lines.append("")
    return "\n".join(lines)


def run_cycle(*, root: Path, now: datetime, fetch, sources=None, gaps=None,
              force: bool = False, drill_failure: str | None = None,
              write_matrix: bool = True) -> dict:
    if now.tzinfo is None:
        now = now.replace(tzinfo=TZ)
    sources = list(SOURCES if sources is None else sources)
    gaps = list(GAPS if gaps is None else gaps)
    folder = civic_dir(root)
    previous = _load(folder / "records.json", {"records": []})
    previous_records = {row["id"]: row for row in previous.get("records") or []}
    state_doc = _load(folder / "collector-state.json", {"sources": {}})
    states = dict(state_doc.get("sources") or {})
    corrections = list(_load(folder / "corrections.json", {"corrections": []}).get("corrections") or [])
    stamp = now_iso(now)
    reports = []
    changes = []
    merged = dict(previous_records)

    for spec in sources:
        state = dict(states.get(spec["id"]) or {})
        if not _due(state, now, force):
            reports.append({"id": spec["id"], "result": "skipped", "error": None, "added": 0, "updated": 0})
            continue
        state["last_attempt_at"] = stamp
        if drill_failure and spec["id"] == drill_failure:
            _fail(state, spec, now, "drill_failure")
            states[spec["id"]] = state
            reports.append({"id": spec["id"], "result": "failed", "error": "drill_failure", "added": 0, "updated": 0})
            continue
        try:
            result = fetch(spec, state)
        except Exception as error:  # noqa: BLE001 - one source must not wipe the store
            message = str(error)[:300]
            _fail(state, spec, now, message)
            states[spec["id"]] = state
            reports.append({"id": spec["id"], "result": "failed", "error": message, "added": 0, "updated": 0})
            continue
        state["last_http_status"] = result.status
        if result.etag:
            state["etag"] = result.etag
        if result.last_modified:
            state["last_modified"] = result.last_modified
        if result.status == 304:
            _succeed(state, spec, now)
            states[spec["id"]] = state
            reports.append({"id": spec["id"], "result": "not_modified", "error": None, "added": 0, "updated": 0})
            continue
        parser = PARSERS.get(spec.get("parser"))
        try:
            if parser is None:
                raise RuntimeError("missing_parser")
            rows = parser(spec, result.body)
        except Exception as error:  # noqa: BLE001
            message = f"parse_error: {error}"[:300]
            _fail(state, spec, now, message)
            states[spec["id"]] = state
            reports.append({"id": spec["id"], "result": "failed", "error": message, "added": 0, "updated": 0})
            continue
        added = updated = 0
        for row in rows:
            record = _finish_record(spec, row, stamp)
            old = merged.get(record["id"])
            if old is None:
                merged[record["id"]] = record
                changes.append({"op": "add", "id": record["id"], "source_id": spec["id"], "at": stamp})
                added += 1
                continue
            comparable = dict(record)
            comparable["collected_at"] = old.get("collected_at")
            comparable["checked_at"] = old.get("checked_at")
            if fingerprint(comparable) == fingerprint(old):
                continue
            fields = {}
            for key in ("title", "text_excerpt", "published_at", "source_url"):
                if old.get(key) != record.get(key):
                    fields[key] = {"previous": old.get(key), "current": record.get(key)}
            if fields:
                corrections.append({
                    "id": "cor-" + hashlib.sha256(f"{record['id']}|{stamp}|{sorted(fields)}".encode("utf-8")).hexdigest()[:16],
                    "record_id": record["id"],
                    "source_id": spec["id"],
                    "changed_at": stamp,
                    "fields": fields,
                    "note": "同一來源識別的文字有變。舊值留在更正紀錄，不把新文字升成已查核。",
                })
            merged[record["id"]] = record
            changes.append({"op": "update", "id": record["id"], "source_id": spec["id"], "at": stamp})
            updated += 1
        _succeed(state, spec, now)
        state["records_kept"] = sum(1 for row in merged.values() if row["source_id"] == spec["id"])
        states[spec["id"]] = state
        reports.append({
            "id": spec["id"], "result": "ok", "error": None, "added": added,
            "updated": updated, "parsed": len(rows),
        })

    for spec in gaps:
        state = dict(states.get(spec["id"]) or {})
        state["health"] = "gap"
        state["error"] = spec.get("gap")
        state["last_success_at"] = None
        state["next_due_at"] = None
        states[spec["id"]] = state
        reports.append({"id": spec["id"], "result": "gap", "error": spec.get("gap"), "added": 0, "updated": 0})

    for spec in sources:
        state = states[spec["id"]]
        state["records_kept"] = sum(1 for row in merged.values() if row["source_id"] == spec["id"])
    records = _sort_records(list(merged.values()))
    digest = content_hash(records)
    attempted = [row for row in reports if row["result"] not in {"gap", "skipped"}]
    successes = [row for row in attempted if row["result"] in {"ok", "not_modified"}]
    failures = [row for row in attempted if row["result"] == "failed"]
    if successes and failures:
        status = "partial"
    elif successes:
        status = "ok"
    elif attempted:
        status = "failed"
    else:
        status = "skipped"
    any_success_at = [states[spec["id"]].get("last_success_at") for spec in sources]
    any_success_at = [value for value in any_success_at if value]
    last_success = max(any_success_at) if any_success_at else None
    public_sources = [_public_source(spec, states.get(spec["id"]) or {}) for spec in sources + gaps]
    feed = {
        "schema_version": 1,
        "etag": f"\"{digest}\"",
        "content_hash": digest,
        "generated_at": stamp,
        "last_attempt_at": stamp if attempted else _load(folder / "feed.json", {}).get("last_attempt_at"),
        "last_success_at": last_success,
        "status": status,
        "stale_after_minutes": STALE_AFTER_MINUTES,
        "changes": changes[:200],
        "changes_truncated": len(changes) > 200,
        "source_health": {row["id"]: row["health"] for row in public_sources},
        "note": "content_hash 只含紀錄內容。last_success_at 是蒐集成功時間，不是發布日或 UI 更新日。status=partial 表示這輪有來源失敗，該來源沿用上次成功紀錄。未查核不等於不實。",
    }
    review = {
        "schema_version": 1,
        "generated_at": stamp,
        "pending_count": sum(1 for row in records if row.get("verification_status") == "unreviewed"),
        "new_ids": [row["id"] for row in changes if row["op"] == "add"][:200],
        "note": "responded 或查核狀態不在這些新紀錄裡。unreviewed 只表示本檔尚未查核，不表示當事人未回應。",
    }
    _dump(folder / "records.json", {"schema_version": 1, "records": records})
    _dump(folder / "sources.json", {"schema_version": 1, "generated_at": stamp, "sources": public_sources})
    _dump(folder / "feed.json", feed)
    _dump(folder / "corrections.json", {"schema_version": 1, "corrections": corrections[-500:]})
    _dump(folder / "review-queue.json", review)
    _dump(folder / "platforms.json", {
        "schema_version": 1,
        "generated_at": stamp,
        "connected": [row for row in public_sources if row["health"] != "gap"],
        "unavailable": [row for row in public_sources if row["health"] == "gap"],
    })
    _dump(folder / "graph.json", GRAPH)
    _dump(folder / "collector-state.json", {"schema_version": 1, "sources": states})
    if write_matrix:
        docs = root / "docs" / "sources"
        docs.mkdir(parents=True, exist_ok=True)
        (docs / "source-matrix.md").write_text(render_matrix(public_sources, stamp), encoding="utf-8")
    _append_log(folder / "collector-log.jsonl", {
        "at": stamp,
        "event": "cycle",
        "status": status,
        "content_hash": digest,
        "added": sum(row["added"] for row in reports),
        "updated": sum(row["updated"] for row in reports),
        "sources": reports,
    })
    return {"status": status, "feed": feed, "reports": reports, "records": len(records)}


def _fail(state: dict, spec: dict, now: datetime, message: str) -> None:
    failures = int(state.get("consecutive_failures") or 0) + 1
    interval = int(spec.get("interval_minutes") or 20)
    state["consecutive_failures"] = failures
    state["health"] = "error"
    state["error"] = message
    state["next_due_at"] = now_iso(now + timedelta(minutes=_backoff_minutes(interval, failures)))


def _succeed(state: dict, spec: dict, now: datetime) -> None:
    interval = int(spec.get("interval_minutes") or 20)
    state["consecutive_failures"] = 0
    state["health"] = "ok"
    state["error"] = None
    state["last_success_at"] = now_iso(now)
    state["next_due_at"] = now_iso(now + timedelta(minutes=interval))


def _append_log(path: Path, event: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    existing.append(json.dumps(event, ensure_ascii=False))
    path.write_text("\n".join(existing[-LOG_LIMIT:]) + "\n", encoding="utf-8")
