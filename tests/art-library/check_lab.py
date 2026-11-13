"""Run the art library browser checks behind the production headers.

    python tests/art-library/check_lab.py                      # public/, standalone page
    python tests/art-library/check_lab.py --root dist --built  # the assembled site

Screenshots go to docs/art-library/screenshots/ (or its built/ subfolder).
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from serve import ROOT, make_server  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default="public")
    parser.add_argument("--built", action="store_true", help="expect the page shell added by the release assembler")
    parser.add_argument("--no-shots", action="store_true")
    parser.add_argument("--shots", help="folder for screenshots, instead of docs/art-library/screenshots")
    args = parser.parse_args()
    root = (ROOT / args.root).resolve()
    if not (root / "asset-lab.html").exists():
        print(f"{root} has no asset-lab.html")
        return 2
    server = make_server(root)
    origin = f"http://127.0.0.1:{server.server_address[1]}"
    threading.Thread(target=server.serve_forever, daemon=True).start()
    shots = (ROOT / args.shots) if args.shots else ROOT / "docs" / "art-library" / "screenshots" / ("built" if args.built else "")
    try:
        command = ["node", str(ROOT / "tests/art-library/verify-lab.mjs"), origin, "" if args.no_shots else str(shots), "built" if args.built else "standalone"]
        return subprocess.run(command, cwd=ROOT).returncode
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    sys.exit(main())
