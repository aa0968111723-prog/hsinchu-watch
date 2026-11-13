# -*- coding: utf-8 -*-
"""網站本身的唯讀 MCP（stdio）：人物、項目、民調、政見／政績、來源、release 資訊。

  python -m hourly.mcp_site --data-dir dist/data          # 讀本機建置輸出
  python -m hourly.mcp_site --live https://hsinchu-watch.pages.dev   # 唯讀 GET /data/*.json（不登入、不寫入）

不寫任何檔、不發布；留言者資訊一律不輸出；engagement null＝未知。
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import classify, views
from .mcp_stdio import Server, Tool, ToolError

MAX_PAGE = 200
SENT_NOTE = classify.SENTIMENT_NOTE


class Source:
    def __init__(self, data_dir: Optional[Path] = None, live: Optional[str] = None):
        self.data_dir, self.live = data_dir, (live.rstrip("/") if live else None)
        self._cache: Dict[str, Any] = {}

    def get(self, name: str) -> Any:
        if name in self._cache:
            return self._cache[name]
        if self.live:
            raw = urllib.request.urlopen(f"{self.live}/data/{name}.json", timeout=30).read()
            val = json.loads(raw)
        else:
            p = Path(self.data_dir) / f"{name}.json"
            val = json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
        self._cache[name] = val
        return val


def _public(it: dict) -> dict:
    p = classify.project_item(it)
    p["review_status_note"] = "站上資料＝規則篩選後上架，不等於已查核"
    return p


def build(src: Source) -> Server:
    def items() -> List[dict]:
        return src.get("items") or []

    def page(rows: List[Any], a: dict) -> dict:
        off, lim = a.get("offset", 0), min(a.get("limit", 50), MAX_PAGE)
        return {"total": len(rows), "offset": off, "limit": lim, "has_more": off + lim < len(rows),
                "rows": rows[off:off + lim]}

    def release(_a):
        m = src.get("manifest") or {}
        return {"release": m.get("release"), "content_sha": m.get("content_sha"), "finalized_at": m.get("finalized_at"),
                "generated_at": m.get("generated_at"), "ui_version": m.get("ui_version"), "counts": m.get("counts"),
                "poll_blackout_active": m.get("poll_blackout_active"), "persons_order": m.get("persons_order"),
                "source": src.live or str(src.data_dir)}

    def persons(_a):
        st = src.get("stats") or {}
        counts: Dict[str, int] = {}
        for it in items():
            counts[it.get("person_id")] = counts.get(it.get("person_id"), 0) + 1
        return {"persons": st.get("persons"), "item_counts": counts, "by_person": st.get("by_person"),
                "note": "item_counts 是上架資料筆數，不是聲量、支持度或民調。"}

    def list_items(a):
        rows = items()
        for k in ("person_id", "platform"):
            if a.get(k):
                rows = [r for r in rows if r.get(k) == a[k]]
        if a.get("layer"):
            rows = [r for r in rows if classify.classify_layer(r)[0] == a["layer"]]
        if a.get("q"):
            q = a["q"].lower()
            rows = [r for r in rows if q in str(r.get("title", "")).lower() or q in str(r.get("summary", "")).lower()]
        rows = sorted(rows, key=lambda r: str(r.get("published_at") or ""), reverse=True)
        out = page(rows, a)
        out["rows"] = [_public(r) for r in out["rows"]]
        out["sentiment_note"] = SENT_NOTE
        return out

    def get_item(a):
        for r in items():
            if r.get("id") == a["item_id"]:
                return _public(r)
        raise ToolError("item not found")

    def polls(a):
        rows = src.get("polls") or []
        if a.get("person_id"):
            rows = [r for r in rows if a["person_id"] in (r.get("person_ids") or [])]
        out = page(rows, a)
        out["note"] = "民調為媒體引述／機構發布；sample_size／moe 為 null＝未知，不是 0。聲量與情緒不是民調。"
        return out

    def policies(a):
        rows = src.get("policies") or []
        if a.get("person_id"):
            rows = [r for r in rows if r.get("person_id") == a["person_id"]]
        if a.get("kind"):
            rows = [r for r in rows if r.get("kind") == a["kind"] or r.get("type") == a["kind"]]
        out = page(rows, a)
        out["note"] = "政見＝主張；政績＝官方或本人宣稱。工程完工不等於驗收或成效；未列＝未知，不是沒有。"
        return out

    def sources(_a):
        st = src.get("stats") or {}
        return {"source_stats": st.get("source_stats"), "source_status": st.get("source_status"),
                "outlet_distribution": st.get("outlet_distribution"),
                "note": "disabled＝robots／平台限制，如實記錄、不繞過。"}

    pg = {"offset": {"type": "integer", "minimum": 0}, "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE}}
    S = lambda props, req=(): {"type": "object", "properties": props, "required": list(req)}  # noqa: E731
    tools = [
        Tool("site_release_info", "網站 release／資料 hash／更新時間／筆數。", S({}), release),
        Tool("site_list_persons", "人物與上架筆數（非聲量）。", S({}), persons),
        Tool("site_list_items", "項目查詢（人物／平台／分層／關鍵字，分頁）。",
             S(dict(pg, person_id={"type": "string"}, platform={"type": "string"},
                    layer={"type": "string", "enum": list(classify.LAYERS)}, q={"type": "string"})), list_items),
        Tool("site_get_item", "單筆項目詳情。", S({"item_id": {"type": "string"}}, ["item_id"]), get_item),
        Tool("site_list_polls", "民調資料（分頁）。", S(dict(pg, person_id={"type": "string"})), polls),
        Tool("site_list_policies", "政見／政績（分頁）。", S(dict(pg, person_id={"type": "string"}, kind={"type": "string"})), policies),
        Tool("site_list_sources", "來源與健康統計。", S({}), sources),
    ]
    return Server("hsinchu-watch-site", "0.1.0", tools, "唯讀；不寫檔、不發布。")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="dist/data")
    ap.add_argument("--live")
    ns = ap.parse_args(argv)
    build(Source(Path(ns.data_dir), ns.live)).serve()
    return 0


if __name__ == "__main__":
    sys.exit(main())
