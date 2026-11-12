# -*- coding: utf-8 -*-
"""補丁 012-sitemap 主線接線：官網 sitemap 文章 → 「本人發言（官網）」條目。

- 條目 source_type=official_statement、display_label=本人發言（官網）、counts_in_stats=False：
  不進首頁時間軸、不計聲量／情緒；finalize 另存 official.json，只在人物頁獨立區塊顯示。
- 官網缺口（例：鄭朝方無官網）寫入 stats.source_stats.sitemap.official_site_gaps。
- 摘要只留前 60 字（與其他來源一致，不轉載全文）。
"""
from __future__ import annotations

import re

from collectors import official_stats, sitemap_reader
from collectors.config import PERSONS
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item

BY_NAME = {p["name"]: p for p in PERSONS}
EXTRA_KEYS = ("source_type", "display_label", "counts_in_stats", "date_source")


def collect():
    result = sitemap_reader.collect_all()
    items = []
    for a in result.get("articles") or []:
        person = BY_NAME.get(a.get("person"))
        if not person or not a.get("url"):
            continue
        it = make_item(person=person, platform="website", source_name=a.get("source_name") or f"{person['name']}官方網站",
                       url=a["url"], title=a.get("title") or "", summary=(a.get("summary") or "")[:60],
                       published_at=a.get("published_at"), is_own_speech=True,
                       sentiment_fn=score_sentiment, topics_fn=tag_topics,
                       extra={k: a.get(k) for k in EXTRA_KEYS if k in a})
        it["source_type"] = "official_statement"
        it["display_label"] = "本人發言（官網）"
        it["counts_in_stats"] = False
        items.append(it)
    sites = result.get("sites") or []
    gaps = official_stats.build_official_site_gaps(sites)
    for g in gaps:  # 不在資料裡留社群帳號（@handle）網址
        g["checked_sources"] = [("（社群帳號頁，略）" if "@" in str(c) else c) for c in (g.get("checked_sources") or [])]
        for k in ("reason",):
            if "@" in str(g.get(k) or ""):
                g[k] = re.sub(r"@[\w.]+", "（帳號略）", str(g[k]))
    stats = {
        "ok": len(items),
        "error": None,
        "counts": result.get("counts"),
        "official_site_gaps": gaps,
        "cutoff": result.get("cutoff"),
        "max_per_person_per_run": result.get("max_per_person_per_run"),
        "max_fetch_per_site": result.get("max_fetch_per_site"),
        "state_path": result.get("state_path"),
        "incremental": {
            r.get("person"): r.get("incremental")
            for r in (result.get("sites") or [])
            if r.get("incremental")
        },
    }
    return items, stats
