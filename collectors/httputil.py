# -*- coding: utf-8 -*-
"""共享 HTTP 逾時（補丁 009）。所有對外請求應走這裡，避免漏傳 timeout。"""
from __future__ import annotations

from typing import Any, Mapping, Optional, Tuple, Union

import feedparser
import requests
import requests.adapters

from collectors.config import REQUEST_TIMEOUT, USER_AGENT

TimeoutType = Union[float, Tuple[float, float]]

# 明確 (connect, read)；config.REQUEST_TIMEOUT 可為 int 或 tuple
def normalize_timeout(timeout: Optional[TimeoutType] = None) -> Tuple[float, float]:
    t = REQUEST_TIMEOUT if timeout is None else timeout
    if isinstance(t, (tuple, list)) and len(t) == 2:
        return (float(t[0]), float(t[1]))
    v = float(t)
    # 單一數字：connect 較短、read 用其餘
    connect = min(5.0, v)
    read = max(v, connect)
    return (connect, read)


class _TimeoutSession(requests.Session):
    """預設帶 timeout 的 Session；呼叫端仍可覆寫。"""

    def request(self, method, url, **kwargs):  # type: ignore[override]
        if kwargs.get("timeout") is None:
            kwargs["timeout"] = normalize_timeout()
        return super().request(method, url, **kwargs)


# 立法院 data.ly.gov.tw 伺服器不支援 RFC 5746 安全重新協商，OpenSSL 3 預設拒連
# （UNSAFE_LEGACY_RENEGOTIATION_DISABLED）。只對這些主機加 OP_LEGACY_SERVER_CONNECT；
# 憑證鏈與主機名驗證維持預設開啟（CERT_REQUIRED + check_hostname），不關驗證。
LEGACY_RENEG_HOSTS = ("data.ly.gov.tw",)


class _LegacyRenegAdapter(requests.adapters.HTTPAdapter):
    def init_poolmanager(self, *a: Any, **kw: Any) -> None:
        import ssl
        ctx = ssl.create_default_context()  # verify_mode=CERT_REQUIRED, check_hostname=True
        ctx.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0x4)
        kw["ssl_context"] = ctx
        super().init_poolmanager(*a, **kw)


def make_session() -> requests.Session:
    s = _TimeoutSession()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "*/*"})
    for host in LEGACY_RENEG_HOSTS:
        s.mount(f"https://{host}/", _LegacyRenegAdapter())
    return s


def http_get(
    url: str,
    *,
    session: Optional[requests.Session] = None,
    timeout: Optional[TimeoutType] = None,
    **kwargs: Any,
) -> requests.Response:
    sess = session or make_session()
    kwargs.setdefault("timeout", normalize_timeout(timeout))
    return sess.get(url, **kwargs)


def fetch_feed(
    url: str,
    *,
    session: Optional[requests.Session] = None,
    timeout: Optional[TimeoutType] = None,
    **kwargs: Any,
) -> Any:
    """feedparser 禁止 parse(url)（無逾時）；一律 requests 取回再 parse。"""
    r = http_get(url, session=session, timeout=timeout, **kwargs)
    r.raise_for_status()
    return feedparser.parse(r.content), r
