"""Check the public snapshot and repository contents before synchronizing."""
from pathlib import Path
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = {"author", "username", "user_name", "screen_name", "commenter_id", "commenter_name", "account", "user_id"}
SECRETS = [re.compile(r"gh[pousr]_" + r"[A-Za-z0-9]{30,}"),
           re.compile(r"github_pat_" + r"[A-Za-z0-9_]{30,}"),
           re.compile(r"sk-" + r"(?:proj-)?[A-Za-z0-9_-]{25,}"),
           re.compile("-----BEGIN " + "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----")]


def walk(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in FORBIDDEN and child:
                raise ValueError("Commenter/account field in public data: " + key)
            walk(child)
    elif isinstance(value, list):
        for child in value:
            walk(child)


def main():
    public = ROOT / "public"
    manifest = json.loads((public / "data/manifest.json").read_bytes())
    for name, expected in manifest["files"].items():
        raw = (public / "data" / name).read_bytes()
        if len(raw) != expected["bytes"] or not hashlib.sha256(raw).hexdigest().startswith(expected["sha256"]):
            raise ValueError("Public data checksum differs: " + name)
    items = json.loads((public / "data/items.json").read_bytes())
    floor = json.loads((ROOT / "tools/release/recovery-floor.json").read_bytes())
    assert len(items) == manifest["counts"]["items_rows"] and len(items) >= floor["items_rows"]
    for directory in [public / "data", public / "observations"]:
        for path in directory.rglob("*.json"):
            walk(json.loads(path.read_bytes()))
    for directory in [ROOT / "src", ROOT / "collectors", ROOT / "scripts", ROOT / "tools", ROOT / ".github", public]:
        for path in directory.rglob("*"):
            if path.suffix not in (".js", ".mjs", ".py", ".json", ".yml", ".toml", ".md") or "__pycache__" in path.parts:
                continue
            content = path.read_text(encoding="utf-8")
            if any(pattern.search(content) for pattern in SECRETS):
                raise ValueError("Credential pattern in " + str(path.relative_to(ROOT)))
    print(json.dumps({"articles": len(items), "public_file_checksums": len(manifest["files"]), "publication_audit": "passed"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
