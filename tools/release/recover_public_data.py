"""Recover published records without losing newer corrections or counting review-only rows."""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import shutil

TPE = timezone(timedelta(hours=8))


def read(path):
    return json.loads(Path(path).read_bytes())


def write(path, data):
    path = Path(path)
    raw = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode()
    if not path.exists() or path.read_bytes() != raw:
        path.write_bytes(raw)


def person(row):
    value = row.get("person_id")
    return "wu_zijia" if value == "wuzijia" else value


def neutralize(row):
    row = dict(row)
    row["person_id"] = person(row)
    if "不留中立" in str(row.get("sentiment_reason") or ""):
        row["sentiment"] = "neu"
        row["sentiment_reason"] = "原標籤僅因沒有批評詞而判為偏正，證據不足；改列中立，待核對原文。"
    return row


def timestamp(row):
    try:
        value = datetime.fromisoformat(str(row.get("published_at") or row.get("collected_at")).replace("Z", "+00:00"))
        return value.replace(tzinfo=TPE) if value.tzinfo is None else value
    except (ValueError, TypeError):
        return None


def outlet(rows):
    counts = Counter(row.get("source_name") or "來源未註明" for row in rows)
    total = len(rows)
    return {"total": total, "outlets": [{"name": name, "count": count, "share": round(count / total, 4)}
                                            for name, count in counts.most_common()]}


def rebuild_statistics(root, items, now=None):
    root = Path(root)
    now = now or datetime.now(TPE)
    stats = read(root / "data/stats.json")
    old = stats.get("by_person", {})
    old = {("wu_zijia" if key == "wuzijia" else key): value for key, value in old.items()}
    # Preserve explicit importer exclusions. Recovery is not independent source verification.
    eligible = [row for row in items if row.get("counts_in_stats", True) and row.get("review_status", "ok") == "ok"]
    people = dict(old)
    for row in items:
        people.setdefault(row.get("person_id"), {"name": row.get("person")})
    by_person = {}
    topics = Counter()
    topic_compare = {}
    for pid, meta in people.items():
        rows = [row for row in eligible if row.get("person_id") == pid]
        daily = Counter()
        for row in rows:
            date = timestamp(row)
            if date and date <= now:
                daily[date.astimezone(TPE).date().isoformat()] += 1
            for topic in row.get("topics") or []:
                topic_compare.setdefault(topic, {})[pid] = topic_compare.get(topic, {}).get(pid, 0) + 1
        comments = [row for row in rows if row.get("platform") == "ptt" and row.get("anonymous_excerpt")]
        by_person[pid] = {
            **{key: value for key, value in meta.items() if key in ("name", "role", "party", "note")},
            "total": len(rows),
            "last_24h": sum(date is not None and timedelta(0) <= now - date <= timedelta(days=1) for date in map(timestamp, rows)),
            "last_7d": sum(date is not None and timedelta(0) <= now - date <= timedelta(days=7) for date in map(timestamp, rows)),
            "sentiment": dict(Counter(row.get("sentiment") or "neu" for row in rows)),
            "platforms": dict(Counter(row.get("platform") for row in rows)),
            "daily_volume": dict(sorted(daily.items())),
            "latest": [{key: row.get(key) for key in ("title", "url", "source_name", "published_at", "platform", "sentiment")}
                       for row in sorted(rows, key=lambda row: row.get("published_at") or "", reverse=True)[:5]],
            "comment_stats": {"samples": len(comments), "sentiment": dict(Counter(row.get("sentiment") or "neu" for row in comments)),
                              "excerpts": [{"text": row["anonymous_excerpt"], "url": row.get("url"), "platform": "ptt", "sentiment": row.get("sentiment") or "neu"} for row in comments[:8]]},
        }
    unique = {row.get("url"): row for row in eligible}
    for row in unique.values():
        topics.update(row.get("topics") or [])
    stats.update({"generated_at": now.isoformat(timespec="seconds"), "finalized_at": now.isoformat(timespec="seconds"),
                  "by_person": by_person, "total_items": len(unique), "total_rows": len(items),
                  "count_policy": "全站依 URL 去重；人物依 URL 與人物去重。counts_in_stats=false 或待審資料保留查閱，不納入統計。未知時間不估算近24小時／7日；偏正偏負不是支持度。",
                  "topics": dict(topics), "topic_compare": topic_compare,
                  "outlet_distribution": {"overall": outlet(list(unique.values())),
                                          "by_person": {pid: outlet([row for row in eligible if row.get("person_id") == pid]) for pid in by_person},
                                          "policy": "同一 URL 在全站只計一次；人物各自保留。"},
                  "polls_count": len(read(root / "data/polls.json"))})
    write(root / "data/stats.json", stats)
    return len(eligible)


def merge(target, previous):
    """target is the incoming snapshot; its records win conflicts with previous."""
    target, previous = Path(target), Path(previous)
    report = {}
    incoming_stats = read(target / "data/stats.json")
    previous_stats = read(previous / "data/stats.json")
    def edition(stats):
        try:
            date = datetime.fromisoformat(str(stats.get("generated_at") or "").replace("Z", "+00:00"))
            return date.replace(tzinfo=TPE) if date.tzinfo is None else date
        except ValueError:
            return datetime.min.replace(tzinfo=TPE)
    incoming_newer = edition(incoming_stats) >= edition(previous_stats)
    for filename in ("items.json", "policies.json", "polls.json"):
        old = read(previous / "data" / filename)
        incoming = read(target / "data" / filename)
        def key(row):
            url = row.get("url") or row.get("source_url")
            if filename == "items.json":
                return url, person(row)
            if filename == "policies.json":
                return url, person(row), row.get("kind"), row.get("title")
            # Each published poll article has one record in these snapshots. Person lists
            # and race labels are corrections, not new polls.
            return url
        restored = len({key(row) for row in old} - {key(row) for row in incoming})
        base, preferred = (old, incoming) if incoming_newer else (incoming, old)
        index = {key(row): neutralize(row) if filename == "items.json" else dict(row) for row in base}
        for row in preferred:
            value = neutralize(row) if filename == "items.json" else dict(row)
            if filename == "items.json":
                value["counts_in_stats"] = row.get("counts_in_stats", True)
            elif "person_id" in value:
                value["person_id"] = person(value)
            index[key(row)] = value
        rows = sorted(index.values(), key=lambda row: row.get("published_at") or "", reverse=True)
        write(target / "data" / filename, rows)
        report[filename] = {"before": len(incoming), "after": len(rows), "restored": restored}
    # Keep published discovery history as well as the main reviewed archive.
    for name in ("history.json", "manual.json"):
        prior = previous / "data/news-monitor" / name
        dest = target / "data/news-monitor" / name
        if prior.exists() and dest.exists():
            old_doc, incoming_doc = read(prior), read(dest)
            base_doc, preferred_doc = ((old_doc, incoming_doc) if incoming_newer
                                       else (incoming_doc, old_doc))
            def discovery_key(row):
                return row.get("id") or row.get("url") or json.dumps(row, sort_keys=True)
            index = {discovery_key(row): row for row in base_doc.get("articles", [])}
            index.update({discovery_key(row): row for row in preferred_doc.get("articles", [])})
            write(dest, {**base_doc, **preferred_doc, "articles": list(index.values())})
    # Carry nested supporting datasets forward when an incoming snapshot omits them.
    for path in (previous / "data").rglob("*.json"):
        dest = target / "data" / path.relative_to(previous / "data")
        if not dest.exists() and not path.name.startswith("items_"):
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
    for directory in ("observations", "reference", "assets", "img"):
        for path in (previous / directory).rglob("*"):
            dest = target / directory / path.relative_to(previous / directory)
            if path.is_file() and not dest.exists():
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, dest)
    items = read(target / "data/items.json")
    for pid in {row.get("person_id") for row in items}:
        write(target / f"data/items_{pid}.json", [row for row in items if row.get("person_id") == pid])
    now = datetime.now(TPE)
    valid = [row for row in items if (date := timestamp(row)) and date <= now]
    write(target / "data/latest.json", valid[:100])
    write(target / "data/latest_24h.json", [row for row in valid if now - timestamp(row) <= timedelta(days=1)])
    if not incoming_newer:
        write(target / "data/stats.json", previous_stats)
    report["counted_person_rows"] = rebuild_statistics(target, items, now)
    manifest = read(target / "data/manifest.json")
    manifest.setdefault("counts", {}).update({"items_rows": len(items), "items_unique_url": len({row.get("url") for row in items}),
                                              "polls": len(read(target / "data/polls.json"))})
    manifest["finalized_at"] = now.isoformat(timespec="seconds")
    write(target / "data/manifest.json", manifest)
    return report


if __name__ == "__main__":
    import sys
    print(json.dumps(merge(*sys.argv[1:3]), ensure_ascii=False))
