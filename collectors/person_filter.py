# -*- coding: utf-8 -*-
"""錯人／地理過濾（FILTER_DECISION + 協調暫定 2026-11-10）。

協調暫定（柏能代理，標「協調暫定」）：
① soft 待審不進主時間軸、不進統計，只顯示「待審 N 筆」
② 別名只接受全名；姓＋職稱須同篇有全名或新竹縣／竹北；網名別稱不收
③ 無地名但有全名：上站、降權、進統計
④ 無姓名民調只進 polls.json，不進人物頁（items）

動作：
- keep：主時間軸＋統計
- soft_downrank：主時間軸＋統計，帶 downrank=True
- soft_review：待審佇列（不進 items／統計）
- drop_hard：excluded（不進人物頁）
"""
from __future__ import annotations

from collections import Counter
from collectors.website_articles import classify_website_item
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

def _tracked_from_keywords() -> dict:
    """關鍵字單一來源：data/keywords.json via collectors.keywords。"""
    from collectors.keywords import KEYWORDS, PERSON_ORDER, filter_terms_for_person
    out = {}
    for pid in PERSON_ORDER:
        k = KEYWORDS[pid]
        out[pid] = {
            "name": k["name"],
            "aliases": tuple(k.get("aliases") or ()),
            "role_hints": tuple(k.get("role_hints") or ()),
            "keywords": filter_terms_for_person(pid),
        }
    return out


TRACKED_PERSONS = _tracked_from_keywords()
# 邱臣遠納入追蹤，但不進首頁主卡。關鍵字檔仍維持既有三人，避免改寫三人份量。
if "chiu" not in TRACKED_PERSONS:
    TRACKED_PERSONS["chiu"] = {
        "name": "邱臣遠",
        "aliases": ("邱臣遠",),
        "role_hints": ("邱立委", "邱副市長", "竹北市長參選人", "邱市長"),
        "keywords": ("竹北", "新竹縣", "民眾黨", "竹北市長"),
    }

# 合併 data/keywords.json（若存在）；歸屬規則不變，只擴充地點／政見關鍵字
try:
    from collectors.keywords import filter_terms_for_person as _kw_terms
    for _pid, _meta in TRACKED_PERSONS.items():
        _extra = _kw_terms(_pid)
        if _extra:
            _merged = tuple(dict.fromkeys(tuple(_meta.get("keywords") or ()) + _extra))
            _meta["keywords"] = _merged
except Exception:
    pass

NAME_TO_ID = {meta["name"]: pid for pid, meta in TRACKED_PERSONS.items()}
TRACKED_NAMES = frozenset(NAME_TO_ID)

NEGATIVE_NAMES = (
    "陳見賢",
    "楊文科",
    "林耕仁",
    "高虹安",
)

GEO_ALLOW = (
    "新竹縣", "竹北", "新竹縣政府", "新竹縣議會", "縣政", "竹科", "科學園區",
    "湖口", "新豐", "芎林", "關西", "橫山", "北埔", "峨眉", "寶山", "竹東",
    "尖石", "五峰", "新埔",
)
GEO_SOFT = ("新竹",)  # 裸「新竹」：僅在已有全名時視為本地
GEO_FOREIGN = (
    "台北", "臺北", "南港", "北車", "台北車站", "蔣萬安", "沈伯洋",
    "高雄", "台中", "臺中", "台南", "臺南", "桃園", "基隆", "宜蘭", "嘉義",
    "屏東", "花蓮", "台東", "金門", "澎湖", "新竹市",
)
FOREIGN_RACE_HINTS = (
    "南港區", "北車", "台北市長", "臺北市長", "新竹市長", "高雄市長", "台中市長",
)

OWN_PAGE_PLATFORMS = frozenset({"website", "council", "ly"})
TEXT_FIELDS = ("title", "summary", "anonymous_excerpt")

HARD_EXCLUDE_REASONS = frozenset({
    "name_absent",
    "negative_name_without_tracked",
    "untracked_person",
    "poll_name_absent",
    "poll_foreign_race",
    "poll_hsinchu_city",
})


@dataclass
class FilterDecision:
    action: str  # keep | soft_downrank | soft_review | drop_hard
    reason: str
    severity: str  # hard | soft | info
    detail: str = ""
    rule: str = "person_filter_r007"


def item_text_blob(item: Mapping[str, Any]) -> str:
    parts = []
    for k in TEXT_FIELDS:
        v = item.get(k)
        if v:
            parts.append(str(v))
    return "\n".join(parts)


def resolve_person(item: Mapping[str, Any]) -> Tuple[str, str]:
    pid = str(item.get("person_id") or "").strip()
    pname = str(item.get("person") or "").strip()
    if pid in TRACKED_PERSONS:
        return pid, TRACKED_PERSONS[pid]["name"]
    if pname in NAME_TO_ID:
        return NAME_TO_ID[pname], pname
    return pid, pname


def geo_allow(blob: str) -> bool:
    return any(g in blob for g in GEO_ALLOW)


def geo_soft(blob: str) -> bool:
    return any(g in blob for g in GEO_SOFT)


def has_full_name(blob: str, pid: str) -> bool:
    meta = TRACKED_PERSONS[pid]
    return any(a and a in blob for a in meta["aliases"])


def has_role_hint_qualified(blob: str, pid: str) -> bool:
    """姓＋職稱：同篇須有全名或 新竹縣／竹北（協調暫定②）。"""
    meta = TRACKED_PERSONS[pid]
    if not any(h in blob for h in meta.get("role_hints") or ()):
        return False
    if has_full_name(blob, pid):
        return True
    return ("新竹縣" in blob) or ("竹北" in blob)


def name_ok(blob: str, pid: str, platform: str) -> bool:
    if has_full_name(blob, pid):
        return True
    if has_role_hint_qualified(blob, pid):
        return True
    if platform in OWN_PAGE_PLATFORMS:
        meta = TRACKED_PERSONS[pid]
        if geo_allow(blob) or any(k in blob for k in meta["keywords"]):
            return True
    return False


def hsinchu_city_only(blob: str) -> bool:
    return ("新竹市" in blob) and ("新竹縣" not in blob) and ("竹北" not in blob)


def foreign_race(blob: str) -> bool:
    return any(h in blob for h in FOREIGN_RACE_HINTS)


def classify_item(item: Mapping[str, Any]) -> FilterDecision:
    pid, pname = resolve_person(item)
    blob = item_text_blob(item)
    platform = str(item.get("platform") or "")

    # 補丁 008：官網非文章頁 → hard exclude（進 excluded，不靜默丟）
    if platform == "website":
        wreason = classify_website_item(item)
        if wreason:
            return FilterDecision("drop_hard", wreason, "hard",
                                  f"官網非文章頁 url={item.get('url')!r}")

    if pid not in TRACKED_PERSONS and pname not in TRACKED_NAMES:
        return FilterDecision("drop_hard", "untracked_person", "hard",
                              f"person={pname!r} person_id={pid!r}")

    meta = TRACKED_PERSONS.get(pid) or TRACKED_PERSONS[NAME_TO_ID[pname]]
    pid = pid if pid in TRACKED_PERSONS else NAME_TO_ID[pname]
    named = name_ok(blob, pid, platform)
    full = has_full_name(blob, pid)
    neg = [n for n in NEGATIVE_NAMES if n in blob]
    foreign = [g for g in GEO_FOREIGN if g in blob]
    allow = geo_allow(blob)
    softg = geo_soft(blob)

    # —— poll：無姓名不進人物頁（④）；可另存 polls.json ——
    if platform == "poll":
        if not full:  # poll 嚴格要求全名（職稱組合不夠）
            return FilterDecision("drop_hard", "poll_name_absent", "hard",
                                  f"poll 未含全名 {meta['name']}，不進 items")
        if foreign_race(blob) and not allow:
            return FilterDecision("drop_hard", "poll_foreign_race", "hard",
                                  "外選區民調提示且無本地白名單")
        if hsinchu_city_only(blob):
            return FilterDecision("drop_hard", "poll_hsinchu_city", "hard",
                                  "新竹市民調不得混入新竹縣人物頁")
        if neg:
            return FilterDecision("soft_review", "poll_neg_co_mention", "soft",
                                  f"共現排除名 {','.join(neg)}")
        if foreign and not allow:
            return FilterDecision("soft_review", "poll_foreign_geo_with_name", "soft",
                                  f"外地提示 {','.join(foreign[:5])}")
        if not allow and not softg:
            return FilterDecision("soft_downrank", "no_local_geo", "info",
                                  "有全名無本地地名：上站降權進統計")
        return FilterDecision("keep", "poll_ok", "info")

    if not named:
        if platform in OWN_PAGE_PLATFORMS:
            return FilterDecision("soft_review", "own_page_weak", "soft",
                                  f"{platform} 缺全名與本地關鍵字")
        if neg:
            return FilterDecision("drop_hard", "negative_name_without_tracked", "hard",
                                  f"排除名 {','.join(neg)} 且無指派姓名")
        return FilterDecision("drop_hard", "name_absent", "hard",
                              f"未含指派姓名 {meta['name']}")

    # 有姓名（全名或合格職稱組合）
    if neg:
        return FilterDecision("soft_review", "neg_co_mention", "soft",
                              f"共現排除名 {','.join(neg)}：待審不上主軸／不進統計")

    if foreign_race(blob) and not allow:
        return FilterDecision("soft_downrank", "foreign_race_with_name", "info",
                              "外選區提示但有姓名：降權")

    if hsinchu_city_only(blob):
        return FilterDecision("soft_review", "hsinchu_city_with_name", "soft",
                              "僅新竹市語境：待審")

    if foreign and not allow and not softg:
        return FilterDecision("soft_downrank", "foreign_geo_with_name", "info",
                              f"外地 {','.join(foreign[:5])}：降權")

    # ③ 無地名但有全名：上站、降權、進統計
    if full and (not allow) and (not softg):
        return FilterDecision("soft_downrank", "no_local_geo", "info",
                              "有全名無本地地名：上站降權進統計")

    return FilterDecision("keep", "ok", "info")


def hard_exclude_reason(item: Mapping[str, Any]) -> Optional[FilterDecision]:
    d = classify_item(item)
    if d.action == "drop_hard":
        return d
    return None


def annotate_for_keep(item: Mapping[str, Any], decision: FilterDecision) -> dict:
    out = dict(item)
    if decision.action == "soft_downrank":
        out["downrank"] = True
        out["filter_reason"] = decision.reason
    else:
        out.pop("downrank", None)
    out["review_status"] = "ok"
    return out


def partition_items(
    items: Sequence[Mapping[str, Any]],
) -> Tuple[List[dict], List[dict], List[dict]]:
    """回傳 (kept_for_timeline_and_stats, pending_review, hard_excluded)。"""
    kept: List[dict] = []
    pending: List[dict] = []
    excluded: List[dict] = []
    for it in items:
        d = classify_item(it)
        if d.action in ("keep", "soft_downrank"):
            kept.append(annotate_for_keep(it, d))
        elif d.action == "soft_review":
            pending.append({
                "kind": "item",
                "id": it.get("id"),
                "person_id": it.get("person_id"),
                "person": it.get("person"),
                "platform": it.get("platform"),
                "title": it.get("title"),
                "url": it.get("url"),
                "reason": d.reason,
                "rule": d.rule,
                "detail": d.detail,
                "review_status": "needs_review",
                "item": dict(it),
            })
        else:
            excluded.append({
                "kind": "item",
                "id": it.get("id"),
                "person_id": it.get("person_id"),
                "person": it.get("person"),
                "platform": it.get("platform"),
                "title": it.get("title"),
                "url": it.get("url"),
                "reason": d.reason,
                "rule": d.rule,
                "detail": d.detail,
                "item": dict(it),
            })
    return kept, pending, excluded


def excluded_payload(excluded: Sequence[Mapping[str, Any]], *, finalized_at: str,
                     pending: Optional[Sequence[Mapping[str, Any]]] = None) -> dict:
    pending = list(pending or [])
    return {
        "finalized_at": finalized_at,
        "source": "collectors.person_filter",
        "count": len(excluded),
        "reasons": dict(Counter(e.get("reason") for e in excluded)),
        "excluded": list(excluded),
        "pending_review_count": len(pending),
        "pending_review_reasons": dict(Counter(e.get("reason") for e in pending)),
        "pending_review": pending,
    }


def stats_review_fields(pending_count: int, downrank_count: int) -> dict:
    """寫入 stats.json：只暴露待審筆數，不含待審內文／帳號。"""
    return {
        "pending_review_count": pending_count,
        "pending_review_label": f"待審 {pending_count} 筆",
        "downrank_count": downrank_count,
    }
