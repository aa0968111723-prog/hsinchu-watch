#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge work/*/POLICY_*.json into published policies.json (SPEC.011).

Prefer POLICY_wu.v2.json over POLICY_wu.json. Missing person files OK.
Drop entries lacking source_name + https source_url + parseable date.
Normalize controversy.responded as source-record metadata (bool|null; never infer from prose).
Special-case w030 Yahoo syndication label → 自由時報（Yahoo 轉載）.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

TZ = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parents[1]
ORDER = ("zheng", "xu", "zhu", "wu", "tseng", "chiu")
UNCORROB_RE = re.compile(r"未獨立查核|未獨立核對|未獨立查證")
FIXTURE_RE = re.compile(r"【fixture】")

# id → hard-drop after spot-check (empty when all passed)
SPOTCHECK_DROPS = {
    "wu": set(),
    "xu": set(),  # re-verified OK 2026-11-10
    "zheng": set(),
}

POLICY_CANDIDATES = {
    "wu": [
        "work/技術總監/POLICY_wu.v2.json",
        "work/技術總監/POLICY_wu.json",
        "work/*/POLICY_wu.v2.json",
        "work/*/POLICY_wu.json",
    ],
    "xu": [
        "work/後端工程師/POLICY_xu.json",
        "work/*/POLICY_xu.json",
    ],
    "zheng": [
        "work/全端工程師/POLICY_zheng.json",
        "work/*/POLICY_zheng.json",
    ],
}


def _arg(flag: str) -> str | None:
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


def find_policy_file(person_id: str) -> Path | None:
    for pattern in POLICY_CANDIDATES.get(person_id, [f"work/*/POLICY_{person_id}.v2.json", f"work/*/POLICY_{person_id}.json"]):
        if "*" in pattern:
            for m in sorted(ROOT.glob(pattern)):
                if m.is_file():
                    return m
        else:
            p = ROOT / pattern
            if p.is_file():
                return p
    return None


def normalize_date(raw) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TZ)
        return dt.astimezone(TZ).isoformat()
    except ValueError:
        pass
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        y, mo, d = map(int, m.groups())
        return datetime(y, mo, d, tzinfo=TZ).isoformat()
    m = re.fullmatch(r"(\d{4})-(\d{2})", s)
    if m:
        y, mo = map(int, m.groups())
        return datetime(y, mo, 1, tzinfo=TZ).isoformat()
    m = re.fullmatch(r"(\d{4})", s)
    if m:
        return datetime(int(m.group(1)), 1, 1, tzinfo=TZ).isoformat()
    return None


def ok_https(u: str) -> bool:
    u = (u or "").strip().lower()
    return u.startswith("https://") and len(u) > 10


def make_id(person_id: str, raw_id, title: str, url: str) -> str:
    if raw_id:
        return str(raw_id)
    h = hashlib.sha256(f"{person_id}|{title}|{url}".encode()).hexdigest()[:12]
    return f"{person_id}-{h}"


def derive_responded(raw: dict) -> bool | None:
    """Keep explicitly supplied source-record status; prose cannot prove a response exists."""
    if "responded" in raw:
        v = raw.get("responded")
        if isinstance(v, bool):
            return v
        if v is None:
            return None
        s = str(v).strip().lower()
        if s in ("true", "1", "yes", "y"):
            return True
        if s in ("false", "0", "no", "n"):
            return False
        return None
    return None  # Missing structured status remains unknown; never infer from notes.



def relabel_source(person_id: str, entry_id: str, source_name: str, source_url: str) -> str:
    """w030: Yahoo syndication of Liberty Times → 自由時報（Yahoo 轉載）."""
    if person_id == "wu" and entry_id == "w030":
        return "自由時報（Yahoo 轉載）"
    if "yahoo" in (source_url or "").lower() and "自由時報" in (source_name or ""):
        return "自由時報（Yahoo 轉載）"
    if person_id == "wu" and entry_id == "w030":
        return "自由時報（Yahoo 轉載）"
    # also if source_name already says Yahoo 轉載自由時報
    sn = source_name or ""
    if "Yahoo" in sn and "自由時報" in sn:
        return "自由時報（Yahoo 轉載）"
    return source_name


def normalize_entry(raw: dict, person_id: str) -> dict | None:
    if not isinstance(raw, dict):
        return None
    eid = str(raw.get("id") or "")
    if eid and eid in SPOTCHECK_DROPS.get(person_id, set()):
        return None
    title = str(raw.get("title") or "").strip()
    if not title or FIXTURE_RE.search(title):
        return None
    source_name = str(raw.get("source_name") or "").strip()
    source_url = str(raw.get("source_url") or raw.get("url") or "").strip()
    if not source_name or not ok_https(source_url):
        return None
    published_at = normalize_date(raw.get("published_at") or raw.get("date") or raw.get("announced_at"))
    if not published_at:
        return None
    source_name = relabel_source(person_id, eid, source_name, source_url)
    kind_raw = raw.get("kind") or raw.get("type") or "policy"
    kind = "record" if kind_raw in ("record", "政績") else "policy"
    note = str(raw.get("note") or "").strip()
    summary = str(raw.get("summary") or raw.get("excerpt") or "").strip()
    uncorroborated = bool(raw.get("uncorroborated")) or bool(
        UNCORROB_RE.search(note) or UNCORROB_RE.search(summary)
    )
    out = {
        "id": make_id(person_id, raw.get("id"), title, source_url),
        "person_id": person_id,
        "kind": kind,
        "title": title,
        "summary": summary,
        "source_name": source_name,
        "source_url": source_url,
        "url": str(raw.get("url") or source_url).strip(),
        "published_at": published_at,
    }
    for k in ("date_precision", "source_type", "raised_by", "note", "http_status", "checked_at"):
        v = raw.get(k)
        if v is not None and v != "":
            out[k] = v
    if raw.get("controversy"):
        out["controversy"] = True
        out["responded"] = derive_responded(raw)  # bool or null
        if "raised_by" not in out:
            out["raised_by"] = str(raw.get("raised_by") or "") or None
    if uncorroborated:
        out["uncorroborated"] = True
    extras = raw.get("extra_sources")
    if isinstance(extras, list) and extras:
        clean = []
        for e in extras:
            if isinstance(e, dict) and ok_https(str(e.get("url") or e.get("source_url") or "")):
                clean.append(e)
            elif isinstance(e, str) and ok_https(e):
                clean.append({"url": e})
        if clean:
            out["extra_sources"] = clean
    return out


def load_person(person_id: str) -> tuple[list[dict], str | None]:
    path = find_policy_file(person_id)
    if not path:
        return [], None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as ex:
        print(f"[build_policies] WARN cannot parse {path}: {ex}", file=sys.stderr)
        return [], str(path)
    if not isinstance(data, list):
        print(f"[build_policies] WARN {path} is not a list", file=sys.stderr)
        return [], str(path)
    out, dropped = [], 0
    for raw in data:
        n = normalize_entry(raw, person_id)
        if n:
            out.append(n)
        else:
            dropped += 1
    print(f"[build_policies] {person_id}: kept={len(out)} dropped={dropped} from {path.relative_to(ROOT)}")
    return out, str(path.relative_to(ROOT))


def build() -> list[dict]:
    by_person: dict[str, list] = {p: [] for p in ORDER}
    for pid in ORDER:
        rows, _ = load_person(pid)
        by_person[pid] = sorted(rows, key=lambda x: str(x.get("published_at") or ""), reverse=True)
    return [row for pid in ORDER for row in by_person[pid]]


def main() -> int:
    out_dir = Path(
        _arg("--out-dir")
        or os.environ.get("HW_OUT")
        or os.environ.get("HSINCHU_PUBLIC_DATA_DIR")
        or ROOT / "public" / "data"
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = build()
    out_path = out_dir / "policies.json"
    out_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    counts = {pid: sum(1 for r in rows if r["person_id"] == pid) for pid in ORDER}
    cont = {pid: sum(1 for r in rows if r["person_id"] == pid and r.get("controversy")) for pid in ORDER}
    print(f"[build_policies] wrote {out_path} total={len(rows)} counts={counts} controversy={cont}")
    # show w030 label
    for r in rows:
        if r.get("id") == "w030":
            print(f"[build_policies] w030 source_name={r.get('source_name')!r}")
            break
    return 0


if __name__ == "__main__":
    sys.exit(main())
