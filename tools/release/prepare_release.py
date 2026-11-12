"""Validate public payloads and assemble a consistent Pages release."""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from os import replace
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = (SCRIPT_DIR.parents[1] if SCRIPT_DIR.name == "release" and SCRIPT_DIR.parent.name == "tools" else SCRIPT_DIR) / "dist"
TPE = timezone(timedelta(hours=8))
POLL_TITLE = re.compile(r"民調|支持度|當選看好度|街訪|街頭(?:調查|訪問)")


def encoded(data):
    return (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def atomic_write(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(prefix=".release-", dir=path.parent, delete=False) as file:
        file.write(raw)
        temporary = file.name
    replace(temporary, path)


def public_url(raw):
    try:
        url = urlsplit(str(raw or "").strip())
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            return None
        if "." not in url.hostname or url.port:
            return None
        query = [(key, value) for key, value in parse_qsl(url.query, keep_blank_values=True)
                 if not key.lower().startswith("utm_") and key.lower() not in ("fbclid", "gclid")]
        return urlunsplit((url.scheme, url.netloc, url.path, urlencode(query), ""))
    except ValueError:
        return None


def article_key(raw):
    url = urlsplit(raw)
    if url.hostname == "udn.com" and re.match(r"/(?:news|vote2026)/story/", url.path):
        return "udn.com/" + url.path.rsplit("/", 1)[-1]
    return raw.rstrip("/")


def source_index(current, items, policies):
    people = current["people"]
    rows = list(current["entries"])
    for item in [*items, *policies]:
        person = item.get("person_id")
        if person not in people:
            continue
        rows.append({
            "personIds": [person], "url": item.get("url") or item.get("source_url"),
            "title": item.get("title"), "source": item.get("source_name"),
            "date": str(item.get("published_at") or "")[:10],
        })
    index = {}
    for row in rows:
        url = public_url(row.get("url"))
        title = str(row.get("title") or "").strip()
        date = str(row.get("date") or "")[:10]
        persons = [person for person in row.get("personIds", []) if person in people]
        if not url or not title or not persons or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            continue
        if POLL_TITLE.search(title):
            continue
        key = article_key(url)
        if key in index:
            index[key]["personIds"] = list(dict.fromkeys([*index[key]["personIds"], *persons]))
            continue
        index[key] = {
            "title": title[:240], "url": url, "date": date,
            "source": str(row.get("source") or urlsplit(url).hostname)[:80],
            "personIds": list(dict.fromkeys(persons)),
        }
    return {"people": people, "entries": sorted(index.values(), key=lambda row: row["date"], reverse=True)}


def prepare(root=ROOT):
    root = Path(root)
    required = {"index.html": 'id="pulseView"', "compare.html": 'id="metricCards"',
                "governance.html": 'id="governanceBoard"', "maps.html": "maps-mobile-", "commentary.html": "watch-comments"}
    for page, marker in required.items():
        if marker not in (root / page).read_text(encoding="utf-8"):
            raise ValueError("Refusing superseded UI: " + page)
    for page in [*root.glob("*.html"), *root.glob("reference/*.html")]:
        if "/assets/editorial-depth-" not in page.read_text(encoding="utf-8"):
            raise ValueError("Missing shared editorial depth stylesheet: " + page.name)
        if "/assets/page-tools-" not in page.read_text(encoding="utf-8"):
            raise ValueError("Missing shared long-page navigation: " + page.name)
    # Inbox importers can append archive-only records; refresh derived totals before hashing.
    current_items = json.loads((root / "data/items.json").read_bytes())
    current_stats = json.loads((root / "data/stats.json").read_bytes())
    if current_stats.get("total_rows") != len(current_items):
        from recover_public_data import rebuild_statistics
        rebuild_statistics(root, current_items)
    manifest_path = root / "data/manifest.json"
    before = {path: path.read_bytes() for path in sorted((root / "data").glob("*.json"))}
    manifest = json.loads(before[manifest_path])
    payloads = {path.name: json.loads(raw) for path, raw in before.items()}
    items = payloads["items.json"]
    assert isinstance(items, list) and isinstance(payloads["policies.json"], list)
    floor_path = Path(__file__).with_name("recovery-floor.json")
    if floor_path.exists() and len(items) < json.loads(floor_path.read_bytes())["items_rows"]:
        raise ValueError("Published records fell below the recovery baseline; merge the snapshot first")
    for pid in {row.get("person_id") for row in items}:
        expected = [row for row in items if row.get("person_id") == pid]
        if payloads.get("items_" + pid + ".json") != expected:
            raise ValueError("Person shard differs from complete dataset: " + str(pid))
    from governance_schema import validate as validate_governance
    validate_governance(payloads["governance.json"], payloads["governance-registry.json"])
    source_path = root / "observations/sources.json"
    existing_sources = source_path.read_bytes()
    sources = source_index(json.loads(existing_sources), items, payloads["policies.json"])
    source_bytes = encoded(sources)
    files = {path.name: {"bytes": len(raw), "sha256": digest(raw)[:16]}
             for path, raw in before.items() if path != manifest_path}
    data_sha = digest(json.dumps(files, sort_keys=True).encode())
    ui_paths = [*root.glob("*.html"), *root.glob("assets/*"), *root.glob("reference/*.html"), *root.glob("observations/*.json")]
    ui_hashes = {str(path.relative_to(root)).replace("\\", "/"): digest(
        source_bytes if path == source_path else path.read_bytes()
    ) for path in sorted(ui_paths) if path.is_file()}
    ui_sha = digest(json.dumps(ui_hashes, sort_keys=True).encode())
    revision = "hsinchu-" + digest((ui_sha + data_sha).encode())[:16]
    now = datetime.now(TPE).isoformat(timespec="seconds")
    data_changed = files != manifest.get("files") or data_sha != manifest.get("content_sha")
    ui_changed = manifest.get("release", {}).get("ui_sha256") != ui_sha
    manifest["files"] = files
    manifest["content_sha"] = data_sha
    manifest.setdefault("counts", {})["items_rows"] = len(items)
    manifest["counts"]["items_unique_url"] = len({row.get("url") for row in items if row.get("url")})
    if data_changed:
        manifest["finalized_at"] = now
    if ui_changed:
        manifest["ui_updated_at"] = now
    manifest["release"] = {"id": revision, "ui_sha256": ui_sha, "data_sha256": data_sha}
    manifest["ui_version"] = "editorial-v4"
    # Abort if an importer advanced any input while the release was assembled.
    if any(path.read_bytes() != raw for path, raw in before.items()) or source_path.read_bytes() != existing_sources:
        raise RuntimeError("Public files changed during release preparation; retry after import")
    if source_bytes != existing_sources:
        atomic_write(source_path, source_bytes)
    manifest_bytes = encoded(manifest)
    if manifest_bytes != before[manifest_path]:
        atomic_write(manifest_path, manifest_bytes)
    return {"version": revision, "articles": len(items), "sources": len(sources["entries"]),
            "verified_files": len(files), "ui_changed": ui_changed, "data_changed": data_changed}


if __name__ == "__main__":
    print(json.dumps(prepare(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT), ensure_ascii=False))
