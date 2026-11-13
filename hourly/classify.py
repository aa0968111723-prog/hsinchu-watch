# -*- coding: utf-8 -*-
"""內容分層（官方發布／新聞／主張／質疑／回應／查核…分開）與公開投影（隱私、未知≠0）。

分層是「關鍵字＋平台」啟發式，一律標 layer_basis 與 待審；不是查核結果。
"""
from __future__ import annotations

import re
from typing import Any, Mapping, Optional

LAYERS = (
    "official_release",   # 官方發布：政府／議會公文與紀錄
    "news",              # 新聞報導
    "claim",             # 主張：候選人／陣營本人自述
    "challenge",         # 質疑（他人對其言行的質疑／批評，啟發式）
    "response",          # 回應（被質疑者的回應／澄清，啟發式）
    "fact_check",        # 查核機構產出（僅來源為查核機構時）
    "commentary",        # 評論／專欄
    "poll_report",       # 媒體引述的民調報導（非原始民調）
    "public_discussion", # 公開討論（PTT／社群等；留言匿名）
    "unclassified",
)

FACT_CHECK_SOURCE_RE = re.compile(r"(台灣事實查核|事實查核|Taiwan ?FactCheck|MyGoPen|Cofacts|真的假的|TFC)", re.I)
CHALLENGE_RE = re.compile(r"(質疑|痛批|抨擊|打臉|砲轟|開轟|批評|反駁|嗆|踢爆|揭露|控訴)")
RESPONSE_RE = re.compile(r"(澄清|回應|回嗆|說明|駁斥|否認|強調不實)")

PRIVACY_KEYS = {
    "author", "user", "handle", "account", "username", "profile", "avatar", "author_name",
    "user_name", "user_id", "account_name", "screen_name", "display_name", "profile_url",
    "profile_image", "profile_link", "avatar_url", "inbox_account",
}
EXCERPT_MAX = 30

# 公開投影白名單（未列者一律不入批次；避免洩漏留言者／內部欄）
PROJECT_KEYS = (
    "id", "person_id", "person", "platform", "source_name", "source_kind", "source_type", "url",
    "title", "summary", "published_at", "date_source", "topics", "is_own_speech", "engagement",
    "dedup_key", "also_reported_by", "related_persons", "board", "feed_id", "type", "poll",
)

SENTIMENT_NOTE = "machine_sentiment 為字面規則標註，不是民調、不代表民意；engagement null＝未知，不是 0。"


def classify_layer(item: Mapping[str, Any]) -> tuple[str, str]:
    """回傳 (layer, basis)。"""
    platform = item.get("platform")
    title = str(item.get("title") or "")
    src = str(item.get("source_name") or "")
    if FACT_CHECK_SOURCE_RE.search(src):
        return "fact_check", "source_is_fact_check_org"
    if platform == "poll":
        return "poll_report", "platform=poll"
    if platform in ("gov", "council"):
        return "official_release", f"platform={platform}"
    if item.get("is_own_speech") is True:
        return "claim", "is_own_speech"
    if platform in ("website", "party"):
        return "claim", f"platform={platform}"
    if platform == "commentary":
        return "commentary", "platform=commentary"
    if platform in ("ptt", "facebook", "youtube", "x"):
        return "public_discussion", f"platform={platform}"
    if platform == "news":
        if RESPONSE_RE.search(title) and not CHALLENGE_RE.search(title):
            return "response", "title_keyword(news)"
        if CHALLENGE_RE.search(title):
            return "challenge", "title_keyword(news)"
        return "news", "platform=news"
    return "unclassified", "no_rule"


def _norm_engagement(e: Any) -> Any:
    # 未知保持 None；不把 None 轉 0
    return e


def project_item(item: Mapping[str, Any]) -> dict:
    """公開投影：白名單欄位、穩定欄位（不含每輪變動的 collected_at）、隱私鍵剔除、摘錄 ≤30 字。"""
    out: dict[str, Any] = {}
    for k in PROJECT_KEYS:
        if k in item:
            out[k] = item[k]
    if "engagement" not in out:
        out["engagement"] = None
    ex = item.get("anonymous_excerpt")
    if isinstance(ex, str) and ex:
        out["anonymous_excerpt"] = ex[:EXCERPT_MAX]
    else:
        out["anonymous_excerpt"] = None
    out["machine_sentiment"] = item.get("sentiment")
    layer, basis = classify_layer(item)
    out["layer"] = layer
    out["layer_basis"] = basis + "(heuristic)"
    # 第一次蒐集時間（穩定語意；不參與 content hash 的是 collected_at）
    out["first_collected_at"] = item.get("first_seen_at") or item.get("collected_at")
    for k in list(out):
        if k.lower() in PRIVACY_KEYS:
            del out[k]
    return out


HASH_EXCLUDE = frozenset({"first_collected_at"})


def hash_view(proj: Mapping[str, Any]) -> dict:
    return {k: v for k, v in proj.items() if k not in HASH_EXCLUDE}


def verification_status(item_id: str, decisions: Mapping[str, Any]) -> tuple[str, Optional[str]]:
    """待審是預設；只有人工裁決檔 confirmed 才顯示「人工核對上架」。程式永不產生「已查核」。"""
    d = decisions.get(item_id)
    if not d:
        return "待審", None
    dec = d.get("decision")
    if dec == "confirmed":
        return "人工核對上架", "review_decisions.json(human)"
    if dec == "rejected":
        return "已排除", "review_decisions.json(human)"
    return "待審", "unverifiable"
