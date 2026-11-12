"""Run browser acceptance checks against an isolated local static server."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    output = ROOT / "artifacts/screens"
    output.mkdir(parents=True, exist_ok=True)
    ThreadingHTTPServer.request_queue_size = 128
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT / "dist")))
    origin = "http://127.0.0.1:" + str(server.server_address[1])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        all_checks = ["verify-production.mjs", "verify-mobile.mjs", "verify-depth-v3.mjs", "verify-maps-mobile.mjs", "verify-observations.mjs", "verify-page-tools.mjs", "verify-governance.mjs"]
        selected = sys.argv[1:] or all_checks
        if any(name not in all_checks for name in selected):
            raise ValueError("Unknown browser check")
        for name in selected:
            result = subprocess.run(["node", str(ROOT / "tools/release" / name), origin, str(output)], cwd=ROOT)
            if result.returncode:
                return result.returncode
    finally:
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
