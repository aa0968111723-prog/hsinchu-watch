# -*- coding: utf-8 -*-
"""網站 MCP 的 Streamable HTTP 傳輸（stdlib）。只服務唯讀網站 MCP；只綁 loopback；不託管、不部署。

  HSINCHU_MCP_TOKEN=... python -m hourly.mcp_http --view-dir public/data --port 8787

- POST /mcp：JSON-RPC（單筆或 batch）。回 application/json；僅通知 → 202。未提供 SSE 串流（GET /mcp → 405）。
- 驗證：環境變數 HSINCHU_MCP_TOKEN 設了就必須帶 `Authorization: Bearer …`（常數時間比對；token 永不寫入 log／檔案／repo）。
- 速率限制：每個用戶端（token 雜湊或位址）token-bucket，預設 60 次/分、突發 20；超過 429 + Retry-After。
- CORS 預設關閉：不送任何 Access-Control-*；帶 Origin 的請求預設 403，除非 HSINCHU_MCP_ALLOWED_ORIGINS 明列。
- Host 檢查（防 DNS rebinding）：只收 localhost／127.0.0.1／[::1]。
- 拒絕綁非 loopback 位址（對外託管需第四線／使用者另行決定，見 docs/hourly/SITE_MCP_HOSTING.md）。
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import ipaddress
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, Optional, Tuple

from . import mcp_site
from .mcp_stdio import SUPPORTED, Server
from .site_view import ViewError

MAX_BODY = 64 * 1024


class RateLimiter:
    def __init__(self, per_minute: int = 60, burst: int = 20, clock=time.monotonic):
        self.rate, self.burst, self.clock = per_minute / 60.0, burst, clock
        self.b: Dict[str, Tuple[float, float]] = {}
        self.lock = threading.Lock()

    def allow(self, key: str) -> Tuple[bool, float]:
        with self.lock:
            now = self.clock()
            tokens, last = self.b.get(key, (float(self.burst), now))
            tokens = min(float(self.burst), tokens + (now - last) * self.rate)
            if tokens >= 1:
                self.b[key] = (tokens - 1, now)
                return True, 0.0
            self.b[key] = (tokens, now)
            return False, (1 - tokens) / self.rate if self.rate else 60.0


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def make_handler(server: Server, token: Optional[str], limiter: RateLimiter, allowed_origins: Tuple[str, ...]):
    tok_hash = hashlib.sha256(token.encode()).digest() if token else None

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "hw-mcp"

        def log_message(self, *a):  # 不記請求內容／標頭（避免 token 外洩）
            pass

        def _send(self, code: int, body: bytes = b"", ctype: str = "application/json", extra: Optional[dict] = None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            origin = self.headers.get("Origin")
            if origin and origin in allowed_origins:  # CORS 只對明列來源開
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if body:
                self.wfile.write(body)

        def _err(self, code: int, msg: str, extra: Optional[dict] = None):
            self._send(code, json.dumps({"error": msg}).encode(), extra=extra)

        def _host_ok(self) -> bool:
            h = (self.headers.get("Host") or "").strip().lower()
            name = h.rsplit(":", 1)[0] if not h.startswith("[") else h.split("]")[0] + "]"
            return name in ("localhost", "127.0.0.1", "[::1]")

        def _guard(self) -> Optional[str]:
            """回傳 client key；不通過時已送出回應並回 None。"""
            if not self._host_ok():
                self._err(403, "host not allowed")
                return None
            origin = self.headers.get("Origin")
            if origin and origin not in allowed_origins:
                self._err(403, "origin not allowed")
                return None
            key = self.client_address[0]
            if tok_hash is not None:
                auth = self.headers.get("Authorization") or ""
                given = auth[7:] if auth.lower().startswith("bearer ") else ""
                if not hmac.compare_digest(hashlib.sha256(given.encode()).digest(), tok_hash):
                    self._err(401, "unauthorized", {"WWW-Authenticate": 'Bearer realm="hsinchu-watch-mcp"'})
                    return None
                key = "tok:" + hashlib.sha256(given.encode()).hexdigest()[:16]
            ok, wait = limiter.allow(key)
            if not ok:
                self._err(429, "rate limited", {"Retry-After": str(max(1, int(wait + 0.999)))})
                return None
            return key

        def do_GET(self):
            if self.path == "/healthz":
                return self._send(200, b'{"ok":true}')
            if self._guard() is None:
                return
            self._err(405, "no SSE stream offered; POST /mcp", {"Allow": "POST"})

        def do_DELETE(self):
            if self._guard() is None:
                return
            self._err(405, "stateless server (no sessions)", {"Allow": "POST"})

        def do_OPTIONS(self):  # 預檢：CORS 關閉時一律拒絕
            origin = self.headers.get("Origin")
            if origin and origin in allowed_origins:
                return self._send(204, b"", extra={"Access-Control-Allow-Methods": "POST",
                                                   "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, accept"})
            self._err(403, "cors disabled")

        def do_POST(self):
            if self.path.split("?")[0] != "/mcp":
                return self._err(404, "not found")
            if self._guard() is None:
                return
            pv = self.headers.get("MCP-Protocol-Version")
            if pv and pv not in SUPPORTED:
                return self._err(400, f"unsupported MCP-Protocol-Version {pv}")
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return self._err(400, "bad length")
            if n <= 0 or n > MAX_BODY:
                return self._err(413 if n > MAX_BODY else 400, "bad body size")
            try:
                msg = json.loads(self.rfile.read(n))
            except Exception:
                return self._send(400, json.dumps({"jsonrpc": "2.0", "id": None,
                                                   "error": {"code": -32700, "message": "parse error"}}).encode())
            if isinstance(msg, list):
                outs = [r for r in (server.handle(m) for m in msg if isinstance(m, dict)) if r]
                return self._send(200, json.dumps(outs, ensure_ascii=False).encode()) if outs else self._send(202)
            if not isinstance(msg, dict):
                return self._err(400, "invalid request")
            resp = server.handle(msg)
            if resp is None:
                return self._send(202)
            self._send(200, json.dumps(resp, ensure_ascii=False).encode())

    return H


def create_server(server: Server, host: str, port: int, *, token: Optional[str] = None, per_minute: int = 60,
                  burst: int = 20, allowed_origins: Tuple[str, ...] = ()) -> ThreadingHTTPServer:
    if not is_loopback(host):
        raise ValueError("refusing to bind a non-loopback address (no public hosting from this code)")
    return ThreadingHTTPServer((host, port), make_handler(server, token, RateLimiter(per_minute, burst), allowed_origins))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--view-dir", default=os.environ.get("HSINCHU_MCP_VIEW_DIR", "public/data"))
    ap.add_argument("--store")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--require-token", action="store_true", help="HSINCHU_MCP_TOKEN 未設定就拒絕啟動")
    ap.add_argument("--rate-per-minute", type=int, default=60)
    ap.add_argument("--burst", type=int, default=20)
    ns = ap.parse_args(argv)
    token = os.environ.get("HSINCHU_MCP_TOKEN") or None
    if ns.require_token and not token:
        print("refused: HSINCHU_MCP_TOKEN is not set", file=sys.stderr)
        return 2
    origins = tuple(o.strip() for o in (os.environ.get("HSINCHU_MCP_ALLOWED_ORIGINS") or "").split(",") if o.strip())
    try:
        srv = mcp_site.build(mcp_site.open_data(ns.view_dir, ns.store))
        httpd = create_server(srv, ns.host, ns.port, token=token, per_minute=ns.rate_per_minute, burst=ns.burst,
                              allowed_origins=origins)
    except (ViewError, ValueError) as e:
        print(f"refused: {e}", file=sys.stderr)
        return 2
    print(f"listening on http://{ns.host}:{httpd.server_address[1]}/mcp (auth={'bearer' if token else 'none/loopback'}, "
          f"cors={'off' if not origins else 'allowlist'})", file=sys.stderr)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
