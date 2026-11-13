# -*- coding: utf-8 -*-
"""官方 Python MCP SDK（mcp==1.30.0，MIT）當用戶端，對我們手寫的 stdlib 伺服器做互通測試（HTTP＋stdio）。
SDK 未安裝則 skip。重現：pip install --target <dir> mcp==1.30.0（需把 pydantic_core/cryptography/rpds/_cffi_backend 的 .so 放在可執行檔案系統）。"""
from __future__ import annotations

import asyncio
import sys
import threading
from pathlib import Path

import pytest

pytest.importorskip("mcp")
from mcp import ClientSession, StdioServerParameters  # noqa: E402
from mcp.client.stdio import stdio_client  # noqa: E402
from mcp.client.streamable_http import streamablehttp_client  # noqa: E402

from hourly import mcp_http  # noqa: E402
import test_hourly_site_mcp as base  # noqa: E402

view = base.view  # fixture reuse


def _structured(res):
    return res.structuredContent if getattr(res, "structuredContent", None) else res.content[0].text


def test_sdk_client_over_streamable_http_with_bearer(view):
    srv, port = base.start(view, token="sdk-test-token")
    try:
        async def run():
            async with streamablehttp_client(f"http://127.0.0.1:{port}/mcp", headers={"Authorization": "Bearer sdk-test-token"}) as (r, w, _):
                async with ClientSession(r, w) as s:
                    init = await s.initialize()
                    tools = await s.list_tools()
                    res = await s.call_tool("list_people", {})
                    bad = await s.call_tool("get_item", {"id": "../../etc/passwd"})
                    return init, tools, res, bad
        init, tools, res, bad = asyncio.run(asyncio.wait_for(run(), 30))
        names = {t.name for t in tools.tools}
        assert init.serverInfo.name == "hsinchu-watch-site" and {"list_people", "search_items", "list_polls"} <= names
        assert all(t.annotations and t.annotations.readOnlyHint for t in tools.tools)
        assert not res.isError and "wu" in str(_structured(res))
        assert bad.isError or "error" in str(_structured(bad)).lower()
    finally:
        srv.shutdown()


def test_sdk_client_rejected_without_token(view):
    srv, port = base.start(view, token="sdk-test-token")
    try:
        async def run():
            async with streamablehttp_client(f"http://127.0.0.1:{port}/mcp") as (r, w, _):
                async with ClientSession(r, w) as s:
                    await s.initialize()
        with pytest.raises(BaseException):
            asyncio.run(asyncio.wait_for(run(), 15))
    finally:
        srv.shutdown()


def test_sdk_client_over_stdio(view):
    repo = Path(__file__).resolve().parents[1]
    params = StdioServerParameters(command=sys.executable, args=["-m", "hourly.mcp_site", "--view-dir", str(view)], cwd=str(repo),
                                   env={"PYTHONPATH": str(repo), "PATH": "/usr/bin:/bin"})

    async def run():
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as s:
                await s.initialize()
                return await s.list_tools(), await s.call_tool("get_manifest", {})
    tools, res = asyncio.run(asyncio.wait_for(run(), 30))
    assert len(tools.tools) == 15 and not res.isError
