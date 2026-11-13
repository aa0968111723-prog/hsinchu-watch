"""Static server that sends the same headers the production site sends.

`python -m http.server` hides two things the real site does to this library:
the Content-Security-Policy refuses inline scripts, and pages may not be framed.
This server reads `_headers` from the served folder, so a preview fails here
whenever it would fail on Cloudflare Pages.

    python tests/art-library/serve.py                 # public/ on 127.0.0.1:4173
    python tests/art-library/serve.py --root dist --port 4199
"""
from __future__ import annotations

import argparse
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".txt": "text/plain; charset=utf-8",
}


def parse_headers(path: Path) -> list[tuple[re.Pattern[str], list[tuple[str, str]]]]:
    """Reads Cloudflare Pages `_headers`: a path line, then indented `Name: value` lines."""
    rules: list[tuple[re.Pattern[str], list[tuple[str, str]]]] = []
    if not path.exists():
        return rules
    current: list[tuple[str, str]] | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw[0] in " \t":
            if current is None:
                raise ValueError(f"header before any path in {path}")
            name, _, value = raw.strip().partition(":")
            current.append((name.strip(), value.strip()))
            continue
        pattern = "".join(".*" if char == "*" else re.escape(char) for char in raw.strip())
        current = []
        rules.append((re.compile(f"^{pattern}$"), current))
    return rules


class Handler(SimpleHTTPRequestHandler):
    rules: list[tuple[re.Pattern[str], list[tuple[str, str]]]] = []

    def log_message(self, *args):  # keep test output readable
        pass

    def copyfile(self, source, outputfile):
        # A browser that closes a page mid-download is not an error worth a traceback.
        try:
            super().copyfile(source, outputfile)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass

    def guess_type(self, path):
        return TYPES.get(Path(path).suffix.lower()) or super().guess_type(path)

    def end_headers(self):
        route = self.path.split("?", 1)[0].split("#", 1)[0]
        merged: dict[str, str] = {}
        for pattern, headers in self.rules:
            if pattern.match(route):
                for name, value in headers:
                    merged[name] = f"{merged[name]}, {value}" if name in merged else value
        for name, value in merged.items():
            self.send_header(name, value)
        super().end_headers()


def make_server(root: Path, port: int = 0) -> ThreadingHTTPServer:
    Handler.rules = parse_headers(root / "_headers")
    ThreadingHTTPServer.request_queue_size = 128
    return ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(root)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default="public")
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    root = (ROOT / args.root).resolve()
    server = make_server(root, args.port)
    print(f"serving {root} with {len(Handler.rules)} header rules at http://127.0.0.1:{server.server_address[1]}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
