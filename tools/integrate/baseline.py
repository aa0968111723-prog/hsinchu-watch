"""Contract checks and the measured public-data baseline."""
from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
CONTROL = Path("D:/Dev/workspaces/hsinchu-cursor-20261113/control")
FLOORS = {
    "items_rows": 9164,
    "source_index_entries": 7205,
    "policies": 1879,
    "archive_rows": 18422,
}
SHELL_PAGES = [
    "index.html", "compare.html", "topics.html", "polls.html", "commentary.html",
    "manual.html", "person.html", "governance.html", "archive.html", "civic.html",
    "public/maps.html", "public/records.html", "public/compare-panels.html",
]
ELECTION_NAV = ["index.html", "compare.html", "topics.html", "polls.html", "commentary.html", "manual.html", "person.html", "civic.html", "public/maps.html", "public/records.html", "public/compare-panels.html"]


def _run(command):
    return subprocess.run(command, cwd=ROOT, check=True, capture_output=True, text=True, encoding="utf-8")


def archive_counts():
    completed = _run(["node", str(ROOT / "tools/integrate/count-archive.mjs")])
    return json.loads(completed.stdout)


def nav_links(path):
    document = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
    nav = document.select_one("nav.civic-nav")
    if nav is None:
        return None, document
    return [(link.get_text(strip=True), link.get("href")) for link in nav.find_all("a")], document


def collect():
    public = ROOT / "public"
    manifest_path = public / "data" / "manifest.json"
    manifest = json.loads(manifest_path.read_bytes())
    files = {}
    mismatches = []
    for name, expected in manifest["files"].items():
        raw = (public / "data" / name).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        files[name] = {"bytes": len(raw), "sha256": digest[:16]}
        if len(raw) != expected["bytes"] or not digest.startswith(expected["sha256"]):
            mismatches.append(name)
    listed = set(manifest["files"])
    on_disk = {path.relative_to(public / "data").as_posix() for path in (public / "data").rglob("*.json") if path.name != "manifest.json"}
    items = json.loads((public / "data" / "items.json").read_bytes())
    policies = json.loads((public / "data" / "policies.json").read_bytes())
    sources = json.loads((public / "observations" / "sources.json").read_bytes())
    comments = json.loads((public / "observations" / "comments.json").read_bytes())
    archive = archive_counts()
    observations = {}
    for path in sorted((public / "observations").glob("*.json")):
        raw = path.read_bytes()
        observations[path.name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()[:16]}
    sections = json.loads((ROOT / "src/lib/civic-sections.json").read_text(encoding="utf-8"))
    expected_links = [(section["title"], section["href"]) for section in sections["sections"]]
    nav_gaps = []
    for relative in SHELL_PAGES:
        found, document = nav_links(ROOT / relative)
        if found != expected_links:
            nav_gaps.append(relative)
        if relative in ELECTION_NAV:
            primary = document.select_one("nav.nav")
            count = len(primary.find_all("a")) if primary else 0
            if count != 6:
                nav_gaps.append(relative + ":primary=" + str(count))
    governance = BeautifulSoup((ROOT / "governance.html").read_text(encoding="utf-8"), "html.parser")
    governance_primary = len(governance.select_one("nav.nav").find_all("a"))
    branch, head = None, None
    try:
        branch = _run(["git", "branch", "--show-current"]).stdout.strip()
        head = _run(["git", "rev-parse", "HEAD"]).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        branch, head = None, None
    lanes = {}
    for name in ("01-ui", "02-data", "03-map", "04-integrate"):
        path = CONTROL / "status" / (name + ".json")
        if path.exists():
            lanes[name] = json.loads(path.read_text(encoding="utf-8"))
    measured = {
        "payload_files": len(manifest["files"]),
        "items_rows": len(items),
        "items_unique_url": manifest["counts"].get("items_unique_url"),
        "policies": len(policies),
        "source_index_entries": len(sources.get("entries", [])),
        "comment_entries": len(comments.get("entries", [])),
        "archive_rows": archive["rows"],
        "archive_by_kind": archive["byKind"],
        "polls_held_in_sample": archive["held"],
    }
    problems = list(mismatches)
    for key, floor in FLOORS.items():
        if measured[key] < floor:
            problems.append(key + " below retained floor")
    if measured["items_rows"] != manifest["counts"]["items_rows"]:
        problems.append("items_rows differs from manifest")
    added = sorted(on_disk - listed)
    if not (public / "data" / "civic" / "feed.json").is_file():
        problems.append("civic feed missing")
    if not (public / "data" / "art-library.json").is_file():
        problems.append("art library index missing")
    if listed - on_disk:
        problems.append("manifest entry missing on disk")
    if nav_gaps:
        problems.append("civic navigation drift")
    if governance_primary != 5:
        problems.append("governance primary navigation changed")
    now = datetime.now(timezone(timedelta(hours=8))).isoformat()
    return {
        "measured_at": now,
        "branch": branch,
        "head": head,
        "floors": FLOORS,
        "measured": measured,
        "checksum_mismatches": mismatches,
        "payload_files": sorted(listed),
        "unmanifested_data": sorted(on_disk - listed),
        "missing_manifest_files": sorted(listed - on_disk),
        "observations": observations,
        "pages": {
            "root": sorted(path.name for path in ROOT.glob("*.html")),
            "public": sorted(path.relative_to(public).as_posix() for path in public.rglob("*.html")),
        },
        "navigation_gaps": nav_gaps,
        "lanes": {name: {"state": row.get("state"), "head": row.get("head") or row.get("base_head"), "current_action": row.get("current_action")} for name, row in lanes.items()},
        "integration_order": "tools/integrate/integration_order.json",
        "problems": problems,
    }
