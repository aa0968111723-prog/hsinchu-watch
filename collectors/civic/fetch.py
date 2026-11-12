"""HTTP fetch with timeouts. Legislative Yuan keeps certificate checks on."""
from __future__ import annotations

import ssl
import urllib.error
import urllib.parse
import urllib.request

from collectors.civic.catalog import UA

MAX_BYTES = 1_500_000


class FetchResult:
    def __init__(self, status: int, body: bytes, headers: dict, url: str):
        self.status = status
        self.body = body
        self.headers = {str(key).lower(): value for key, value in headers.items()}
        self.url = url

    @property
    def etag(self) -> str | None:
        return self.headers.get("etag")

    @property
    def last_modified(self) -> str | None:
        return self.headers.get("last-modified")


def _context_for(url: str):
    context = ssl.create_default_context()
    if urllib.parse.urlsplit(url).hostname == "data.ly.gov.tw":
        context.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
    return context


def fetch(spec: dict, state: dict, timeout: float = 25) -> FetchResult:
    headers = {
        "User-Agent": UA,
        "Accept": spec.get("accept") or "*/*",
    }
    if state.get("etag"):
        headers["If-None-Match"] = state["etag"]
    if state.get("last_modified"):
        headers["If-Modified-Since"] = state["last_modified"]
    request = urllib.request.Request(spec["url"], headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=_context_for(spec["url"])) as response:
            body = response.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise RuntimeError(f"response_truncated>{MAX_BYTES}")
            return FetchResult(response.status, body, dict(response.headers), response.geturl())
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return FetchResult(304, b"", dict(error.headers or {}), spec["url"])
        detail = error.read(500).decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {error.code} {detail[:180]}") from error
