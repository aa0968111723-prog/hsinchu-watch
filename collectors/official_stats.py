# -*- coding: utf-8 -*-
"""官網文章統計輔助：官網本人發言不計入聲量／情緒；缺口供前端顯示。"""
from __future__ import annotations

from typing import Any, Iterable

OFFICIAL_SOURCE_TYPE = "official_statement"
OFFICIAL_DISPLAY_LABEL = "本人發言（官網）"


def tag_official_article(item: dict[str, Any]) -> dict[str, Any]:
    out = dict(item)
    out["source_type"] = OFFICIAL_SOURCE_TYPE
    out["display_label"] = OFFICIAL_DISPLAY_LABEL
    out["counts_in_stats"] = False
    return out


def filter_for_volume_sentiment(items: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """聲量／情緒統計用：排除 counts_in_stats is False 或官網本人發言。"""
    out = []
    for it in items:
        if it.get("counts_in_stats") is False:
            continue
        if it.get("source_type") == OFFICIAL_SOURCE_TYPE:
            continue
        out.append(it)
    return out


def build_official_site_gaps(site_reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    gaps = []
    for r in site_reports:
        has = bool(r.get("official_website")) and not r.get("skip_reason")
        if has and r.get("error") and "缺口" in str(r.get("error")):
            has = False
        if r.get("official_website") is None or r.get("skip_reason"):
            has = False
        gap = {
            "person": r.get("person"),
            "has_official_site": bool(r.get("official_website")) and not bool(r.get("skip_reason")),
            "reason": r.get("skip_reason") or r.get("error"),
            "checked_sources": r.get("checked_sources") or [],
            "official_website": r.get("official_website"),
        }
        # 前端「無官網」：has_official_site false
        if not gap["has_official_site"]:
            gaps.append(gap)
        else:
            # 仍輸出有官網列供前端對照
            gaps.append(gap)
    return gaps


def sentiment_volume_counts(items: Iterable[dict[str, Any]]) -> dict[str, Any]:
    usable = filter_for_volume_sentiment(items)
    by_person: dict[str, dict[str, int]] = {}
    for it in usable:
        p = it.get("person") or "?"
        bucket = by_person.setdefault(p, {"volume": 0, "pos": 0, "neu": 0, "neg": 0})
        bucket["volume"] += 1
        s = it.get("sentiment") or "neu"
        if s in bucket:
            bucket[s] += 1
        else:
            bucket["neu"] += 1
    return {"by_person": by_person, "total": len(usable)}
