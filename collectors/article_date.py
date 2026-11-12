# -*- coding: utf-8 -*-
"""加強文章日期解析（不放寬標題／正文規則）。

優先序（依本輪需求）：
1. JSON-LD datePublished（含 @graph）
2. meta article:published_time
3. <time datetime>
4. 既有規則（其他 published meta、time 文字、dateModified、DATE_RE）
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from bs4 import BeautifulSoup

DATE_RE = re.compile(
    r"(?:"
    r"20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?"
    r"|"
    r"\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*20\d{2}"
    r")",
    re.I,
)


def _walk_ld_published(obj: Any, out: list[str]) -> None:
    if isinstance(obj, list):
        for x in obj:
            _walk_ld_published(x, out)
        return
    if not isinstance(obj, dict):
        return
    if obj.get("datePublished"):
        out.append(str(obj["datePublished"]))
    if "@graph" in obj:
        _walk_ld_published(obj["@graph"], out)
    if "mainEntity" in obj:
        _walk_ld_published(obj["mainEntity"], out)


def _walk_ld_modified(obj: Any, out: list[str]) -> None:
    if isinstance(obj, list):
        for x in obj:
            _walk_ld_modified(x, out)
        return
    if not isinstance(obj, dict):
        return
    if obj.get("dateModified"):
        out.append(str(obj["dateModified"]))
    if "@graph" in obj:
        _walk_ld_modified(obj["@graph"], out)
    if "mainEntity" in obj:
        _walk_ld_modified(obj["mainEntity"], out)


def extract_published_raw(html: str) -> tuple[Optional[str], Optional[str]]:
    """回傳 (raw_date, source_label)。"""
    soup = BeautifulSoup(html or "", "lxml")

    # 1 JSON-LD datePublished
    pubs: list[str] = []
    scripts = list(soup.find_all("script", attrs={"type": "application/ld+json"}))
    for sc in scripts:
        raw = sc.string or sc.get_text() or ""
        try:
            data = json.loads(raw)
        except Exception:
            continue
        _walk_ld_published(data, pubs)
    if pubs and pubs[0].strip():
        return pubs[0].strip(), "jsonld:datePublished"

    # 2 meta article:published_time
    for meta in soup.find_all("meta"):
        prop = (meta.get("property") or meta.get("name") or "").lower()
        if prop == "article:published_time" and meta.get("content"):
            return meta["content"].strip(), "meta:article:published_time"

    # 3 <time datetime>
    for time_el in soup.find_all("time"):
        dt = time_el.get("datetime")
        if dt and DATE_RE.search(dt):
            return dt.strip(), "time:datetime"

    # 4 existing rules
    for prefer in (
        "pubdate",
        "publishdate",
        "publish_date",
        "dc.date",
        "parsely-pub-date",
        "date",
        "og:updated_time",
        "article:modified_time",
    ):
        for meta in soup.find_all("meta"):
            prop = (meta.get("property") or meta.get("name") or "").lower()
            if prop == prefer and meta.get("content"):
                return meta["content"].strip(), f"meta:{prop}"

    for time_el in soup.find_all("time"):
        tx = time_el.get_text(" ", strip=True)
        if tx and DATE_RE.search(tx):
            return tx, "time:text"

    mods: list[str] = []
    for sc in scripts:
        raw = sc.string or sc.get_text() or ""
        try:
            data = json.loads(raw)
        except Exception:
            continue
        _walk_ld_modified(data, mods)
    if mods and mods[0].strip():
        return mods[0].strip(), "jsonld:dateModified"

    m = DATE_RE.search(html or "")
    if m:
        return m.group(0), "html:DATE_RE"
    return None, None
