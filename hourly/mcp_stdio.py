# -*- coding: utf-8 -*-
"""最小 MCP stdio server（stdlib only）：JSON-RPC 2.0，逐行 JSON（newline-delimited）。

支援 initialize / notifications/initialized / ping / tools/list / tools/call。
僅 stdio；不開 socket、不對外託管。
"""
from __future__ import annotations

import json
import sys
from typing import Any, Callable, Dict, List, Optional

SUPPORTED = ("2025-06-18", "2025-03-26", "2024-11-05")


class ToolError(Exception):
    pass


class Tool:
    def __init__(self, name: str, description: str, schema: dict, fn: Callable[[dict], Any], read_only: bool = True):
        self.name, self.description, self.schema, self.fn, self.read_only = name, description, schema, fn, read_only

    def spec(self) -> dict:
        return {"name": self.name, "description": self.description, "inputSchema": self.schema,
                "annotations": {"readOnlyHint": self.read_only, "openWorldHint": False}}


_TYPES = {"string": str, "integer": int, "boolean": bool, "number": (int, float), "object": dict, "array": list}


def validate_args(schema: dict, args: dict) -> None:
    props = schema.get("properties", {})
    for r in schema.get("required", []):
        if r not in args:
            raise ToolError(f"missing required argument: {r}")
    for k, v in args.items():
        if k not in props:
            raise ToolError(f"unknown argument: {k}")
        t = props[k].get("type")
        if t and not (isinstance(v, _TYPES[t]) and not (t == "integer" and isinstance(v, bool))):
            raise ToolError(f"argument {k} must be {t}")
        if "enum" in props[k] and v not in props[k]["enum"]:
            raise ToolError(f"argument {k} must be one of {props[k]['enum']}")
        if t == "string" and "maxLength" in props[k] and len(v) > props[k]["maxLength"]:
            raise ToolError(f"argument {k} too long")
        if t == "string" and len(v) > 2000:
            raise ToolError(f"argument {k} too long")
        if t == "integer":
            if "minimum" in props[k] and v < props[k]["minimum"]:
                raise ToolError(f"argument {k} < minimum")
            if "maximum" in props[k] and v > props[k]["maximum"]:
                raise ToolError(f"argument {k} > maximum")


class Server:
    def __init__(self, name: str, version: str, tools: List[Tool], instructions: str = ""):
        self.name, self.version, self.instructions = name, version, instructions
        self.tools = {t.name: t for t in tools}

    def handle(self, msg: dict) -> Optional[dict]:
        mid = msg.get("id")
        method = msg.get("method")
        params = msg.get("params") or {}
        is_note = "id" not in msg
        try:
            if method == "initialize":
                req = params.get("protocolVersion")
                res = {"protocolVersion": req if req in SUPPORTED else SUPPORTED[0],
                       "capabilities": {"tools": {"listChanged": False}},
                       "serverInfo": {"name": self.name, "version": self.version}}
                if self.instructions:
                    res["instructions"] = self.instructions
            elif method == "ping":
                res = {}
            elif method == "tools/list":
                res = {"tools": [t.spec() for t in self.tools.values()]}
            elif method == "tools/call":
                res = self._call(params)
            elif is_note:
                return None
            else:
                return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}
        except Exception as e:  # 協定層錯誤
            if is_note:
                return None
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": f"{type(e).__name__}: {e}"}}
        if is_note:
            return None
        return {"jsonrpc": "2.0", "id": mid, "result": res}

    def _call(self, params: dict) -> dict:
        name = params.get("name")
        t = self.tools.get(name)
        if not t:
            return {"isError": True, "content": [{"type": "text", "text": f"unknown tool: {name}"}]}
        try:
            args = params.get("arguments") or {}
            validate_args(t.schema, args)
            out = t.fn(args)
            return {"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}],
                    "structuredContent": out if isinstance(out, dict) else {"result": out}}
        except ToolError as e:
            return {"isError": True, "content": [{"type": "text", "text": f"error: {e}"}]}
        except Exception as e:
            return {"isError": True, "content": [{"type": "text", "text": f"internal error: {type(e).__name__}: {e}"}]}

    def serve(self, stdin=None, stdout=None) -> None:
        stdin = stdin or sys.stdin
        stdout = stdout or sys.stdout
        for line in stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                stdout.write(json.dumps({"jsonrpc": "2.0", "id": None,
                                         "error": {"code": -32700, "message": "parse error"}}) + "\n")
                stdout.flush()
                continue
            if isinstance(msg, list):  # batch
                outs = [r for r in (self.handle(m) for m in msg) if r]
                if outs:
                    stdout.write(json.dumps(outs, ensure_ascii=False) + "\n")
                    stdout.flush()
                continue
            resp = self.handle(msg)
            if resp is not None:
                stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
                stdout.flush()
