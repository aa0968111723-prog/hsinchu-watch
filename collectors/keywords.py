# -*- coding: utf-8 -*-
"""關鍵字庫：data/keywords.json 為單一來源（收集器＋前台字雲共用）。

歸屬規則不變：全名（names）才算姓名命中；titles／職稱須同篇有全名或新竹縣／竹北。
不從 collectors.config 匯入，避免循環依賴。
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ORDER = PERSON_ORDER = ["wu", "xu", "zheng"]
PARTY = {"wu": ("中國國民黨", "國民黨"), "xu": ("中國國民黨", "國民黨"), "zheng": ("民主進步黨", "民進黨")}
RACE = {"wu": "竹北市長", "xu": "新竹縣長", "zheng": "新竹縣長"}


def keywords_path() -> Path:
    env = __import__("os").environ.get("HSINCHU_DATA_DIR")
    if env and (Path(env) / "keywords.json").is_file():
        return Path(env) / "keywords.json"
    return ROOT / "data" / "keywords.json"


@lru_cache(maxsize=4)
def load_keywords(path: str | None = None) -> dict[str, Any]:
    p = Path(path) if path else keywords_path()
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(d, dict) and isinstance(d.get("persons"), dict):
            return d
    except Exception:
        pass
    return {"version": 0, "persons": {}, "shared_places": [], "shared_topics": []}


def clear_cache() -> None:
    load_keywords.cache_clear()


def person_keywords(pid: str) -> dict[str, Any]:
    return dict((load_keywords().get("persons") or {}).get(pid) or {})


def all_terms(pid: str, *, include_shared: bool = True) -> list[str]:
    """去重後的關鍵字清單（全名＋職稱＋政見＋地點等），供比對／雲圖。"""
    kw = person_keywords(pid)
    out: list[str] = []
    for key in ("names", "titles", "campaign", "places", "policies", "events", "query_extra"):
        for t in kw.get(key) or []:
            s = str(t).strip()
            if s and s not in out:
                out.append(s)
    if include_shared:
        doc = load_keywords()
        for t in list(doc.get("shared_places") or []) + list(doc.get("shared_topics") or []):
            s = str(t).strip()
            if s and s not in out:
                out.append(s)
    return out


def search_queries(pid: str) -> list[str]:
    """蒐集查詢字串：必含全名；附加地點／職稱擴充。"""
    meta = person_keywords(pid) or {}
    name = meta.get("name")
    if not name:
        return []
    extras = list(meta.get("query_extra") or [])[:6]
    places = list(meta.get("places") or [])[:4]
    qs = [name]
    for e in extras:
        qs.append(f"{name} {e}")
    for pl in places[:2]:
        q = f"{name} {pl}"
        if q not in qs:
            qs.append(q)
    seen, out = set(), []
    for q in qs:
        if q not in seen:
            seen.add(q)
            out.append(q)
    return out


def filter_terms_for_person(pid: str) -> tuple[str, ...]:
    """person_filter 用地點／議題關鍵字（不含全名本身）。"""
    kw = person_keywords(pid)
    terms: list[str] = []
    for key in ("places", "policies", "query_extra", "events"):
        for t in kw.get(key) or []:
            s = str(t).strip()
            if s and s != kw.get("name") and s not in terms:
                terms.append(s)
    # 共享地名／主題
    doc = load_keywords()
    for t in list(doc.get("shared_places") or [])[:8] + list(doc.get("shared_topics") or [])[:6]:
        s = str(t).strip()
        if s and s not in terms:
            terms.append(s)
    party = PARTY.get(pid)
    if party:
        for p in party:
            if p not in terms:
                terms.append(p)
    race = RACE.get(pid)
    if race and race not in terms:
        terms.append(race)
    return tuple(terms)


def count_hits(items: list[dict], pid: str | None = None) -> list[dict[str, Any]]:
    """依標題／摘要／topics 統計關鍵字命中；回傳 [{term, count}] 降序。"""
    doc = load_keywords()
    persons = doc.get("persons") or {}
    pids = [pid] if pid else ORDER
    bag: dict[str, int] = {}
    term_set: set[str] = set()
    for p in pids:
        for t in all_terms(p, include_shared=True):
            if len(t) >= 2:
                term_set.add(t)
    for it in items or []:
        if pid and it.get("person_id") != pid:
            continue
        blob = f"{it.get('title') or ''} {it.get('summary') or ''}"
        for t in it.get("topics") or []:
            s = str(t).strip()
            if s:
                bag[s] = bag.get(s, 0) + 1
        for t in term_set:
            if t in blob:
                bag[t] = bag.get(t, 0) + 1
    names = {persons[p].get("name") for p in persons}
    rows = [{"term": k, "count": v} for k, v in bag.items() if k not in names and v > 0]
    rows.sort(key=lambda r: (-r["count"], r["term"]))
    return rows


def summary_counts() -> dict[str, Any]:
    doc = load_keywords()
    out = {
        "shared_places": len(doc.get("shared_places") or []),
        "shared_topics": len(doc.get("shared_topics") or []),
        "by_person": {},
    }
    for pid in ORDER:
        terms = all_terms(pid, include_shared=False)
        out["by_person"][pid] = {
            "name": (person_keywords(pid) or {}).get("name"),
            "term_count": len(terms),
            "terms": terms,
        }
    return out


# ---- 相容層：給 person_filter／config／前台字雲 ----

def _compat_person(pid: str) -> dict[str, Any]:
    kw = person_keywords(pid)
    party, party_short = PARTY.get(pid, ("", ""))
    return {
        "id": pid,
        "name": kw.get("name") or "",
        "party": party,
        "party_short": party_short,
        "race": RACE.get(pid, ""),
        "aliases": tuple(kw.get("names") or ((kw.get("name"),) if kw.get("name") else ())),
        "role_hints": tuple(kw.get("titles") or ()),
        "places": tuple(kw.get("places") or ()),
        "topics": tuple(kw.get("policies") or ()),
        "search_terms": tuple(search_queries(pid)),
    }


# 懶載：避免 import 當下讀檔失敗
class _KeywordsProxy(dict):
    def __getitem__(self, key):
        self._ensure()
        return dict.__getitem__(self, key)

    def get(self, key, default=None):
        self._ensure()
        return dict.get(self, key, default)

    def __contains__(self, key):
        self._ensure()
        return dict.__contains__(self, key)

    def keys(self):
        self._ensure()
        return dict.keys(self)

    def items(self):
        self._ensure()
        return dict.items(self)

    def _ensure(self):
        if dict.__len__(self) == 0:
            for pid in ORDER:
                dict.__setitem__(self, pid, _compat_person(pid))


KEYWORDS = _KeywordsProxy()


def apply_to_person_dict(person: dict[str, Any]) -> dict[str, Any]:
    """把 keywords.json 併入 config PERSONS 條目（不覆寫 id/website）。"""
    pid = person.get("id")
    k = _compat_person(pid) if pid in ORDER else {}
    if not k:
        return person
    out = dict(person)
    aliases = list(out.get("aliases") or [])
    for a in k.get("aliases") or ():
        if a not in aliases:
            aliases.append(a)
    out["aliases"] = aliases
    out["role_hints"] = list(k.get("role_hints") or ())
    out["topic_keywords"] = list(k.get("topics") or ())
    out["place_keywords"] = list(k.get("places") or ())
    out["search_terms"] = list(k.get("search_terms") or ())
    geo = list(out.get("geo_filters") or [])
    for g in list(k.get("places") or ()) + list(load_keywords().get("shared_places") or [])[:6]:
        if g not in geo:
            geo.append(g)
    out["geo_filters"] = geo
    return out


def cloud_payload() -> dict[str, Any]:
    """前台字雲格式（persons 為陣列）。不覆寫 data/keywords.json 原結構。"""
    doc = load_keywords()
    persons = []
    for pid in ORDER:
        k = _compat_person(pid)
        raw = person_keywords(pid)
        chips = []
        for group, weight, values in (
            ("aliases", 3, k.get("aliases") or ()),
            ("role_hints", 2, k.get("role_hints") or ()),
            ("campaign", 2, raw.get("campaign") or ()),
            ("places", 2, list(k.get("places") or ()) + list(doc.get("shared_places") or [])[:6]),
            ("topics", 1, list(k.get("topics") or ()) + list(doc.get("shared_topics") or [])[:8]),
            ("search_terms", 2, k.get("search_terms") or ()),
        ):
            for term in values:
                chips.append({"term": term, "group": group, "weight": weight})
        if k.get("party_short"):
            chips.append({"term": k["party_short"], "group": "party", "weight": 2})
        if k.get("race"):
            chips.append({"term": k["race"], "group": "race", "weight": 3})
        seen, uniq = set(), []
        for c in chips:
            t = str(c["term"]).strip()
            if not t or t in seen:
                continue
            seen.add(t)
            uniq.append({**c, "term": t})
        persons.append({
            "id": pid,
            "name": k["name"],
            "party": k["party"],
            "party_short": k["party_short"],
            "race": k["race"],
            "counts": {
                "aliases": len(k.get("aliases") or ()),
                "role_hints": len(k.get("role_hints") or ()),
                "places": len(k.get("places") or ()),
                "topics": len(k.get("topics") or ()),
                "search_terms": len(k.get("search_terms") or ()),
                "terms_all": len(all_terms(pid, include_shared=False)),
                "chips": len(uniq),
            },
            "chips": uniq,
        })
    return {"version": 1, "order": list(ORDER), "persons": persons, "source": "data/keywords.json"}
