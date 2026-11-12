# -*- coding: utf-8 -*-
"""發布前資料整理：data/*.json（原始，不改）→ public/data/*.json（公開）。

規則：
- 每筆須有 source_name + http(s) url；否則排除。
- 錯人過濾：標題／摘要／摘錄須含「指派人物」姓名；否則排除（陳見賢等排除名獨現不進人物頁）。邱臣遠為追蹤人物，不進首頁主卡。
- 民調：race 正規化（新竹縣長→county_magistrate、竹北市長→zhubei_mayor）；
  缺機構／期間／樣本／連結者只標「民調報導」、不出數字；
  2026-11-18 00:00 ~ 2026-11-28 16:00（Asia/Taipei）封關期間一律不出數字。
- 全站總數／熱度以 URL 去重計一次；人物頁保留各自筆數。
- 另產 latest.json（最新 100 則，URL 去重）與 latest_24h.json、policies.json、manifest.json；排除清單寫 data/excluded.json（不公開）。
"""
from __future__ import annotations
import hashlib, json, os, sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

TZ = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parents[1]
def _arg(flag):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


SRC = Path(_arg("--data-dir") or os.environ.get("HW_SRC") or os.environ.get("HSINCHU_DATA_DIR") or ROOT / "data")
OUT = Path(_arg("--public-data-dir") or os.environ.get("HW_OUT") or os.environ.get("HSINCHU_PUBLIC_DATA_DIR")
           or ROOT / "public" / "data")
# 蒐集端（run_all／person_filter）已寫 data/excluded.json（含待審）；發布端另存，不覆寫
EXCLUDED_OUT = Path(os.environ.get("HW_EXCLUDED", SRC / "excluded_publish.json"))
# 民調數字總開關：期間／樣本皆缺且部分「支持度」實為領先差距（POLLS_CHECK_r1）→ 一律不出數字
# 只有 data/polls_verified.json（人工逐筆核對原文）裡的民調才顯示數字；蒐集器粗解析的數字一律不出
POLL_NUMBERS_ENABLED = True
RACE_PERSONS = {"county_magistrate": ("xu", "zheng"), "zhubei_mayor": ("wu",)}


def group_verified_polls(polls):
    """同一份已核對民調（機構＋期間＋樣本＋選區相同）的多則報導合併為一筆；
    其餘報導列為 reports（全部連結保留，不刪資料）。未核對的「民調報導」不合併。"""
    groups, order = {}, []
    for q in polls:
        if not q.get("verified"):
            order.append(("single", q))
            continue
        # 機構＋開始日＋樣本＋選區＋對決情境相同＝同一份民調（各報導結束日偶有不一，另註明）
        key = (q.get("org"), q.get("field_start") or q.get("period"), str(q.get("sample_size")), q.get("race"),
               q.get("scenario") or "")
        if key not in groups:
            groups[key] = []
            order.append(("group", key))
        groups[key].append(q)
    out = []
    for kind, v in order:
        if kind == "single":
            out.append(v)
            continue
        members = sorted(groups[v], key=lambda q: str(q.get("published_at") or ""))
        primary = dict(members[0])
        primary["reports"] = [{"title": m.get("title"), "source_name": m.get("source_name"),
                               "url": m.get("url"), "published_at": m.get("published_at")} for m in members]
        primary["report_count"] = len(members)
        if not primary.get("matchups"):
            for m in members:
                if m.get("matchups"):
                    primary["matchups"] = m["matchups"]
                    break
        periods = sorted({str(m.get("period")) for m in members if m.get("period")})
        if len(periods) > 1:
            primary["period_note"] = "各報導所載調查期間不一：" + "、".join(periods)
        primary["group_key"] = "|".join(str(x) for x in v)
        out.append(primary)
    return out


def load_held():
    """hold 中的民調（例：機構待釐清）：標題 → 待驗證說明。"""
    for path in (SRC / "polls_verified.json", ROOT / "data" / "polls_verified.json"):
        if path.exists():
            doc = json.loads(path.read_text(encoding="utf-8"))
            return {v["title"]: (v.get("hold") or {}).get("public_note") or "待驗證：民調機構未見官方原始發布"
                    for v in doc.get("polls", []) if v.get("title") and v.get("hold")}
    return {}


def load_verified():
    for path in (SRC / "polls_verified.json", ROOT / "data" / "polls_verified.json"):
        if path.exists():
            doc = json.loads(path.read_text(encoding="utf-8"))
            # hold：機構等疑點未釐清者暫不當已核對（回到「民調報導」、不顯示數字；紀錄保留不刪）
            return {v["title"]: v for v in doc.get("polls", []) if v.get("title") and not v.get("hold")}
    return {}

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from collectors.person_filter import classify_item  # noqa: E402
from collectors.sentiment import score_sentiment  # noqa: E402

ORDER = ["wu", "xu", "zheng"]  # 首頁主卡：吳→徐→鄭
SHARD_IDS = ["wu", "xu", "zheng", "chiu"]  # 人物分片含邱臣遠
NAMES = {"wu": "吳旭智", "xu": "徐欣瑩", "zheng": "鄭朝方", "chiu": "邱臣遠"}
ALIASES = {"wu": ("吳旭智",), "xu": ("徐欣瑩",), "zheng": ("鄭朝方",), "chiu": ("邱臣遠",)}
NEGATIVE_NAMES = ("陳見賢", "楊文科", "林耕仁", "高虹安")
RACE_MAP = {"新竹縣長": "county_magistrate", "竹北市長": "zhubei_mayor"}
RACE_LABEL = {"county_magistrate": "新竹縣長", "zhubei_mayor": "竹北市長"}
GENERIC_ORGS = {"", "民調", "未標示機構", None}
BLACKOUT_START = datetime(2026, 11, 18, 0, 0, tzinfo=TZ)
BLACKOUT_END = datetime(2026, 11, 28, 16, 0, tzinfo=TZ)


def in_blackout(now=None):
    now = now or datetime.now(TZ)
    return BLACKOUT_START <= now < BLACKOUT_END


def ok_url(u):
    u = str(u or "").strip()
    return u.lower().startswith(("http://", "https://")) and len(u) > 10


def blob(it):
    return "\n".join(str(it.get(k) or "") for k in ("title", "summary", "anonymous_excerpt"))


def _public_source_stats(ss):
    """發布用 source_stats：官網缺口的查證清單含社群帳號網址（@handle），只留在 data/ 不公開。"""
    ss = json.loads(json.dumps(ss or {}, ensure_ascii=False))
    for g in ((ss.get("sitemap") or {}).get("official_site_gaps") or []):
        if isinstance(g, dict):
            n = len(g.pop("checked_sources", None) or [])
            if n:
                g["checked_sources_count"] = n
    return ss


def official_payload(official, old):
    """人物頁「本人發言（官網）」區塊資料＋官網缺口（例：鄭朝方無官網）。不計入任何統計。"""
    gaps = ((old.get("source_stats") or {}).get("sitemap") or {}).get("official_site_gaps")
    if not gaps:
        try:
            from collectors import official_stats, sitemap_reader
            gaps = official_stats.build_official_site_gaps(
                [{"person": s["person"], "official_website": s.get("official_website"),
                  "skip_reason": s.get("skip_reason"), "checked_sources": s.get("checked_sources")}
                 for s in sitemap_reader.SITES])
        except Exception:
            gaps = []
    name_to_id = {v: k for k, v in NAMES.items()}
    gap_by = {}
    for g in gaps or []:
        pid = name_to_id.get(g.get("person"))
        if pid:
            gap_by[pid] = {"has_official_site": bool(g.get("has_official_site")),
                           "note": (f"{NAMES[pid]}無官網" if not g.get("has_official_site") else None),
                           "reason": g.get("reason")}
    by = {}
    for pid in ORDER:
        rows = sorted([i for i in official if i["person_id"] == pid],
                      key=lambda i: i.get("published_at") or "", reverse=True)
        by[pid] = {"count": len(rows), "gap": gap_by.get(pid), "items": rows}
    try:  # 官方帳號連結卡（只放網址；不向 Meta 請求）
        from collectors import social as _social
        _chan = _social.public_channels()
    except Exception:
        _chan = {}
    for _pid, _row in by.items():
        _row["official_channels"] = _chan.get(_pid, {})
    return {"label": "本人發言（官網）", "counts_in_stats": False,
            "note": "候選人官網文章，屬本人／競選團隊自述；不計入聲量、情緒與全站總數。", "by_person": by}


def check_item(it):
    """URL／出處 + person_filter（協調暫定：待審不進主軸）。"""
    if not ok_url(it.get("url")):
        return "missing_or_bad_url"
    if not str(it.get("source_name") or "").strip():
        return "missing_source_name"
    if it.get("person_id") not in NAMES:
        return "untracked_person"
    d = classify_item(it)
    if d.action == "drop_hard":
        return d.reason
    if d.action == "soft_review":
        return "pending_review:" + d.reason
    # 站規：標題須含指派人物全名（僅摘要有名 → pending_review；ACCURACY_1110）
    title = str(it.get("title") or "")
    if not any(a in title for a in ALIASES[it["person_id"]]):
        if any(a in blob(it) for a in ALIASES[it["person_id"]]):
            return "pending_review:name_absent_title"
        return "name_absent_own_page"
    return None


def poll_text(p):
    return str(p.get("title") or "") + "\n" + str(p.get("note") or "")


def finalize_poll(p, blackout):
    q = dict(p)
    race = q.get("race")
    q["race"] = RACE_MAP.get(race, race)
    q["race_label"] = RACE_LABEL.get(q["race"], race or "")
    verified = bool(q.pop("_verified_record", False)) and q.get("org") not in GENERIC_ORGS \
        and bool(q.get("period")) and bool(q.get("sample_size")) and ok_url(q.get("url"))
    if verified:  # 只留該選區的追蹤人物數字
        allowed = RACE_PERSONS.get(q["race"], ())
        q["support"] = {k: v for k, v in (q.get("support") or {}).items() if k in allowed}
        verified = bool(q["support"])
        # 多對決情境：每個情境只留追蹤三人數字；非追蹤人選只留名字（不公開其數字）
        mus = []
        for m in q.get("matchups") or []:
            sup = {k: v for k, v in (m.get("support") or {}).items() if k in allowed}
            if sup:
                mus.append({"scenario": m.get("scenario"), "support": sup,
                            "other_candidates": [o.get("label") for o in (m.get("other_candidates") or []) if o.get("label")]})
        if mus:
            q["matchups"] = mus
        else:
            q.pop("matchups", None)
    q["verified"] = verified and POLL_NUMBERS_ENABLED
    title = str(q.get("title") or "")
    if not q.get("source_name") and " - " in title:
        q["source_name"] = title.rsplit(" - ", 1)[1].strip()
    q["label"] = "民調" if q["verified"] else "民調報導"
    hide = blackout or not q["verified"]
    q["numbers_hidden"] = hide
    if hide:
        for k in ("support", "raw_percents", "moe", "matchups"):
            q.pop(k, None)
        if q.get("note") and "數字" in q["note"]:
            q["note"] = ""
    if blackout:
        q["blackout"] = True
    return q


def dedupe_urls(items):
    seen, out = set(), []
    for i in items:
        if i["url"] in seen:
            continue
        seen.add(i["url"])
        out.append(i)
    return out


def build_stats(items, old, polls):
    now = datetime.now(TZ)
    old_bp = old.get("by_person", {}) if isinstance(old, dict) else {}
    persons_meta = {p["id"]: p for p in (old.get("persons") or [])}
    by_person = {}
    for pid in ORDER:
        sub = [i for i in items if i["person_id"] == pid]
        daily, l24, l7 = Counter(), 0, 0
        for i in sub:
            ts = i.get("published_at") or i.get("collected_at") or ""
            if ts:
                daily[ts[:10]] += 1
                try:
                    dt = datetime.fromisoformat(ts)
                    dt = dt if dt.tzinfo else dt.replace(tzinfo=TZ)
                    age = (now - dt).total_seconds()
                    l24 += age <= 86400
                    l7 += age <= 7 * 86400
                except Exception:
                    pass
        ob = old_bp.get(pid, {})
        cs = dict(ob.get("comment_stats") or {"samples": 0, "sentiment": {}, "excerpts": []})
        cs["excerpts"] = [e for e in cs.get("excerpts", []) if ok_url(e.get("url"))]
        meta = persons_meta.get(pid, {})
        by_person[pid] = {
            "name": NAMES[pid], "role": meta.get("role", ob.get("role", "")),
            "party": meta.get("party", ob.get("party", "")),
            "total": len(sub), "last_24h": int(l24), "last_7d": int(l7),
            "sentiment": dict(Counter(i.get("sentiment", "neu") for i in sub)),
            "platforms": dict(Counter(i.get("platform") for i in sub)),
            "daily_volume": dict(sorted(daily.items())[-14:]),
            "latest": [{"title": i.get("title"), "url": i.get("url"), "source_name": i.get("source_name"),
                        "published_at": i.get("published_at"), "platform": i.get("platform"),
                        "sentiment": i.get("sentiment")} for i in sub[:5]],
            "comment_stats": cs,
        }
    uniq = dedupe_urls(items)
    # 議題三人對照：人物欄各自計；全站議題熱度同 URL 只算一次
    topic_compare = defaultdict(lambda: {pid: 0 for pid in ORDER})
    for i in items:
        for t in i.get("topics") or []:
            topic_compare[t][i["person_id"]] += 1
    st = {
        "generated_at": old.get("generated_at") or now.isoformat(),
        "finalized_at": now.isoformat(),
        "timezone": "Asia/Taipei",
        "total_items": len(uniq),          # 全站：URL 去重
        "total_rows": len(items),          # 人物頁合計（共同提及各算一次）
        "count_policy": "全站總數與熱度同一 URL 只算一次；人物頁各自保留",
        "by_person": by_person,
        "topics": dict(Counter(t for i in uniq for t in (i.get("topics") or []))),
        "topic_compare": {k: dict(v) for k, v in topic_compare.items()},
        "source_stats": _public_source_stats(old.get("source_stats", {})),
        "persons": [{"id": pid, "name": NAMES[pid], "role": by_person[pid]["role"],
                     "party": by_person[pid]["party"]} for pid in ORDER],
        "poll_blackout": {"active": in_blackout(), "start": BLACKOUT_START.isoformat(), "end": BLACKOUT_END.isoformat()},
        "disclaimer": old.get("disclaimer") or "本站自動彙整公開資料，中立呈現，不代表本站立場。請以原文連結為準。",
    }
    # 補丁 011：新聞來源（outlet）分布——以發布後資料計；全站同一網址只算一次，人物各自計
    def _outlets(subset):
        def _outlet(i):  # Google News 只是轉介；以標題尾的原媒體名計
            sn = str(i.get("source_name") or i.get("platform") or "未標示")
            t = str(i.get("title") or "")
            if sn == "Google News" and " - " in t:
                return t.rsplit(" - ", 1)[1].strip() or sn
            return sn
        c = Counter(_outlet(i) for i in subset)
        n = len(subset)
        # 用陣列保序（輸出鍵排序後 dict 會變字母序）
        return {"total": n, "outlets": [{"name": k, "count": v, "share": round(v / n, 4) if n else 0.0}
                                        for k, v in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))]}
    st["outlet_distribution"] = {"overall": _outlets(uniq),
                                 "by_person": {pid: _outlets([i for i in items if i["person_id"] == pid])
                                               for pid in ORDER},
                                 "policy": "全站：同一網址算一次；人物：各自計（共同提及分別列入）"}
    # 瘦身：民調清單只放 polls.json（民調頁自取；封關期間不請求）；stats 只留計數
    st["polls_count"] = len(polls)
    return st


def dump(path, obj):
    # 鍵排序：同內容每輪輸出位元組相同（預算監管員 CF_QUOTA_0151：無實質變更不部署）
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


# 每輪都會變、但不代表資料有變的欄位（不納入 content_sha）
VOLATILE_KEYS = frozenset({"generated_at", "finalized_at", "collected_at", "fetched_at", "elapsed_sec",
                           "spot_checked_at", "verified_at", "last_24h", "last_7d", "attempts"})


def _strip_volatile(o):
    if isinstance(o, dict):
        return {k: _strip_volatile(v) for k, v in o.items() if k not in VOLATILE_KEYS}
    if isinstance(o, list):
        return [_strip_volatile(v) for v in o]
    return o


def content_sha(out_dir):
    h = hashlib.sha256()
    for f in sorted(out_dir.glob("*.json")):
        if f.name == "manifest.json":
            continue
        h.update(f.name.encode())
        h.update(json.dumps(_strip_volatile(json.loads(f.read_text(encoding="utf-8"))), ensure_ascii=False,
                            sort_keys=True).encode())
    return h.hexdigest()


def main() -> int:
    items = json.loads((SRC / "items.json").read_text(encoding="utf-8"))
    polls = json.loads((SRC / "polls.json").read_text(encoding="utf-8")) if (SRC / "polls.json").exists() else []
    old = json.loads((SRC / "stats.json").read_text(encoding="utf-8")) if (SRC / "stats.json").exists() else {}
    now = datetime.now(TZ)
    blackout = in_blackout(now)

    # curated LATEST_*.json（每輪重跑；outlet 為 source_name；URL 去重）
    try:
        from scripts.curated_latest import curated_items as _curated_items
        _exist = {str(i.get("url") or "") for i in items}
        _extra, _cst = _curated_items(_exist, ROOT)
        if _extra:
            items = list(items) + _extra
            print(f"[finalize] curated_latest added={_cst.get('added')} files={_cst.get('files')} skipped_dup={_cst.get('skipped_dup')} invalid={_cst.get('skipped_invalid')}")
    except Exception as _ex:
        print(f"[finalize] curated_latest skip: {_ex}")

    # ACCURACY_1110_suggested.json person_suspicions（item id → pending_review）
    _ACC_SUSPICION_IDS = set()
    try:
        _acc = json.loads((ROOT / "work/資料庫實際測試與管理改善專家/ACCURACY_1110_suggested.json").read_text(encoding="utf-8"))
        for _s in _acc.get("person_suspicions") or []:
            _sid = str(_s.get("id") or "")
            if _sid and not _sid.startswith("poll:"):
                _ACC_SUSPICION_IDS.add(_sid)
    except Exception:
        pass

    kept, excluded = [], []
    for it in items:
        if str(it.get("id") or "") in _ACC_SUSPICION_IDS:
            excluded.append({"kind": "item", "id": it.get("id"), "person_id": it.get("person_id"),
                             "platform": it.get("platform"), "title": it.get("title"), "url": it.get("url"),
                             "reason": "pending_review:accuracy_person_suspicion"})
            continue
        r = check_item(it)
        if r:
            excluded.append({"kind": "item", "id": it.get("id"), "person_id": it.get("person_id"),
                             "platform": it.get("platform"), "title": it.get("title"), "url": it.get("url"),
                             "reason": r})
            continue
        it = dict(it)
        # 分類器 r1（支持度／支持率／領先／民調子句中性＋逐句人物歸屬）在發布時重算，
        # 讓沿用的舊條目（舊規則打的標籤）也一致
        if it.get("platform") != "poll":
            try:
                it["sentiment"] = score_sentiment(f"{it.get('title') or ''} {it.get('summary') or ''}",
                                                  NAMES[it["person_id"]])
            except Exception:
                pass
        d2 = classify_item(it)
        if d2.action == "soft_downrank":
            it["downrank"] = True
            it["filter_reason"] = d2.reason
        if it.get("platform") == "poll":
            it["sentiment"] = "neu"  # 民調報導不計情緒（支持度／領先非評價）
            for k in ("support", "raw_percents", "moe"):
                it.pop(k, None)
            if isinstance(it.get("poll"), dict):
                race = it["poll"].get("race")
                it["poll"] = {"race": RACE_MAP.get(race, race), "label": "民調報導", "numbers_hidden": True}
            t = str(it.get("title") or "")
            if " - " in t and str(it.get("source_name", "")).startswith("民調"):
                it["source_name"] = t.rsplit(" - ", 1)[1].strip()
            it["summary"] = "民調報導（封關期間不顯示數字）" if blackout else "民調報導（數字請以原文為準）"
        kept.append(it)

    # 012：本人發言（官網）不進主軸／首頁／統計，另存 official.json 只給人物頁獨立區塊
    official = [i for i in kept if i.get("source_type") == "official_statement" or i.get("counts_in_stats") is False]
    kept = [i for i in kept if not (i.get("source_type") == "official_statement" or i.get("counts_in_stats") is False)]

    # ACCURACY_1110：發布端顯示去重（不刪 raw data/）；also_reported_by 連到其他出處
    _before_counts = {pid: sum(1 for i in kept if i.get("person_id") == pid) for pid in ORDER}
    try:
        from scripts.publish_dedupe import display_dedupe as _display_dedupe
        kept, _dst = _display_dedupe(kept)
        _after_counts = {pid: sum(1 for i in kept if i.get("person_id") == pid) for pid in ORDER}
        print(f"[finalize] display_dedupe groups={_dst.get('groups')} removed={_dst.get('removed')} "
              f"before={_before_counts} after={_after_counts}")
    except Exception as _ex:
        print(f"[finalize] display_dedupe skip: {_ex}")

    kept_polls = []
    verified_map = load_verified()
    held_map = load_held()
    seen_verified = set()
    for p0 in polls:
        p = p0
        vrec = verified_map.get(p0.get("title"))
        if vrec:
            seen_verified.add(vrec["title"])
            p = {**p0, **{k: v for k, v in vrec.items() if k != "verification"}, "_verified_record": True,
                 "news_url": p0.get("url"), "raw_percents": None}
        t = poll_text(p)
        reason = None
        if vrec:
            pass  # 已人工核對（選區與人物以核對紀錄為準）
        elif not ok_url(p.get("url")):
            reason = "missing_or_bad_url"
        elif not any(n in t for n in NAMES.values()):
            neg = [n for n in NEGATIVE_NAMES if n in t]
            reason = ("negative_name_without_tracked:" + ",".join(neg)) if neg else "name_absent"
        # ACCURACY_1110：標題完全沒有追蹤人物全名 → 待審不上架（含民調 DOC 題名）
        title_only = str(p.get("title") or "")
        if reason is None and not any(n in title_only for n in NAMES.values()):
            reason = "pending_review:poll_name_absent_title"
        if reason:
            excluded.append({"kind": "poll", "title": p.get("title"), "url": p.get("url"), "reason": reason})
            continue
        q = finalize_poll(p, blackout)
        if p0.get("title") in held_map and not q.get("verified"):
            q["pending_note"] = held_map[p0.get("title")]
        if not q.get("source_name"):
            excluded.append({"kind": "poll", "title": p.get("title"), "url": p.get("url"), "reason": "missing_source_name"})
            continue
        q["person_ids"] = ([pid for pid in ORDER if pid in RACE_PERSONS.get(q["race"], ())] if q["verified"]
                           else [pid for pid in ORDER if NAMES[pid] in t])
        kept_polls.append(q)
    # 蒐集器若已不再帶出某筆已核對民調，仍保留（不被覆寫掉）
    for title, vrec in verified_map.items():
        if title in seen_verified:
            continue
        p = {k: v for k, v in vrec.items() if k != "verification"}
        p["_verified_record"] = True
        p.setdefault("published_at", vrec.get("field_end"))
        q = finalize_poll(p, blackout)
        q["person_ids"] = [pid for pid in ORDER if pid in RACE_PERSONS.get(q["race"], ())]
        title_only = str(p.get("title") or "")
        if not any(n in title_only for n in NAMES.values()):
            excluded.append({"kind": "poll", "title": p.get("title"), "url": p.get("url"),
                             "reason": "pending_review:poll_name_absent_title"})
            continue
        kept_polls.append(q)

    kept_polls = group_verified_polls(kept_polls)
    stats = build_stats(kept, old, kept_polls)
    # 010-footer: embed source_status from PUBLISHED kept items/polls (no hardcoded counts)
    try:
        import sys as _sys
        from pathlib import Path as _Path
        _sys.path.insert(0, str(_Path(__file__).resolve().parent))
        from source_status import compute_source_status as _css
        stats["source_status"] = _css(kept, kept_polls, stats)
        _n_off = sum(1 for _i in official if _i.get("source_type") != "official_social")
        for _r in stats["source_status"]:
            if _r.get("id") == "websites" and _n_off:
                _r.update(status="active", count=_n_off, reason=None,
                          status_text=f"官網文章 {_n_off} 篇（只列在人物頁「本人發言（官網）」，不計統計）")
    except Exception as _ex:  # pragma: no cover — footer can fall back
        stats["source_status"] = [{"id": "pending", "label": "來源狀態", "group": "active_collectors",
                                   "status": "pending", "status_text": "狀態待確認", "count": 0,
                                   "reason": f"source_status compute failed: {_ex}"}]
    OUT.mkdir(parents=True, exist_ok=True)
    dump(OUT / "items.json", kept)
    try:
        from scripts.publish_dedupe import items_for_person as _items_for_person
        for pid in SHARD_IDS:
            dump(OUT / f"items_{pid}.json", _items_for_person(kept, pid))
    except Exception:
        for pid in SHARD_IDS:
            dump(OUT / f"items_{pid}.json", [i for i in kept if i["person_id"] == pid])
    dump(OUT / "official.json", official_payload(official, old))
    dump(OUT / "polls.json", kept_polls)
    pending_n = sum(1 for e in excluded if str(e.get("reason") or "").startswith("pending_review"))
    # 若蒐集端已先分流（data/items.json 只剩 kept），沿用其待審計數
    pending_n = max(pending_n, int(old.get("pending_review_count") or 0))
    downrank_n = sum(1 for i in kept if i.get("downrank"))
    stats["pending_review_count"] = pending_n
    stats["pending_review_label"] = f"待審 {pending_n} 筆"
    stats["downrank_count"] = downrank_n
    dump(OUT / "stats.json", stats)
    _sorted_latest = dedupe_urls(sorted(
        kept, key=lambda i: i.get("published_at") or i.get("first_seen_at") or i.get("collected_at") or "", reverse=True))
    latest = _sorted_latest[:100]
    dump(OUT / "latest.json", latest)
    _cut = (datetime.now(TZ) - timedelta(hours=24)).isoformat()
    def _ts(i):
        return i.get("published_at") or i.get("first_seen_at") or i.get("collected_at") or ""
    latest_24h = [i for i in _sorted_latest if _ts(i) >= _cut]
    dump(OUT / "latest_24h.json", latest_24h)
    try:
        from scripts.build_policies import build as _build_policies
        policies = _build_policies()
        dump(OUT / "policies.json", policies)
        _pc = {pid: sum(1 for x in policies if x.get("person_id") == pid) for pid in ORDER}
        print(f"[finalize] policies total={len(policies)} by={_pc}")
    except Exception as _ex:
        print(f"[finalize] policies skip: {_ex}")
        dump(OUT / "policies.json", [])
    try:
        from collectors.keywords import cloud_payload as _kw_cloud, clear_cache as _kw_clear
        _kw_clear()
        _kw = _kw_cloud()
        dump(OUT / "keywords.json", _kw)  # 前台字雲格式；不覆寫 data/keywords.json 原結構
        print(f"[finalize] keywords chips=" + str({p['id']: p['counts']['chips'] for p in _kw['persons']}))
    except Exception as _ex:
        print(f"[finalize] keywords skip: {_ex}")
        dump(OUT / "keywords.json", {"version": 1, "order": [], "persons": []})
    files = {}
    for f in sorted(OUT.glob("*.json")):
        if f.name == "manifest.json":
            continue
        b = f.read_bytes()
        files[f.name] = {"bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()[:16]}
    def _excluded_counts(n_publish):
        """排除數分兩段：蒐集端（data/excluded.json：excluded＋pending_review）＋發布端（本檔 finalize）。
        自蒐集端先分流後，發布端數字變小屬正常，不代表資料遺失。"""
        try:
            src = json.loads((SRC / "excluded.json").read_text(encoding="utf-8"))
            ce = len(src.get("excluded") or []) if isinstance(src.get("excluded"), list) else int(src.get("count") or 0)
            cp = len(src.get("pending_review") or []) if isinstance(src.get("pending_review"), list) else 0
        except Exception:
            ce, cp = 0, 0
        # excluded＝真正排除（蒐集端＋發布端）；待審 pending_review 不算排除，只計入 not_shown_total
        return {"excluded": ce + n_publish, "excluded_publish": n_publish,
                "excluded_collect": ce, "pending_review": cp,
                "not_shown_total": ce + n_publish + cp,
                "counts_note": "excluded=excluded_collect+excluded_publish；not_shown_total=excluded+pending_review（待審未上站，非排除）"}
    dump(OUT / "manifest.json", {"generated_at": stats["generated_at"], "finalized_at": stats["finalized_at"],
                                 "timezone": "Asia/Taipei", "persons_order": ORDER,
                                 "counts": {"items_rows": len(kept), "items_unique_url": stats["total_items"],
                                            "polls": len(kept_polls), **_excluded_counts(len(excluded))},
                                 "poll_blackout_active": blackout, "files": files,
                                 "content_sha": content_sha(OUT)})
    dump(EXCLUDED_OUT, {"finalized_at": stats["finalized_at"], "count": len(excluded),
                                 "reasons": dict(Counter(e["reason"] for e in excluded)), "excluded": excluded})
    print(f"items kept={len(kept)} unique_url={stats['total_items']} polls kept={len(kept_polls)} "
          f"excluded={len(excluded)} {dict(Counter(e['kind']+':'+e['reason'] for e in excluded))} blackout={blackout}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
