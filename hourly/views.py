# -*- coding: utf-8 -*-
"""讀取視圖：物件 + 更正疊加。驗證狀態預設「待審」；程式永不產生「已查核」。"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import classify
from .store import Store

FAIRNESS = {
    "layers": list(classify.LAYERS),
    "note": ("官方發布／新聞／主張／質疑／回應／查核分層呈現，不湊正負各半；"
             + classify.SENTIMENT_NOTE + " 工程完工不等於驗收或成效；留言匿名；平台限制如實記錄。"),
}


def verification_label(store: Store, item_id: str, upto_corr: Optional[int] = None) -> Dict[str, Any]:
    status, basis = "待審", None
    last = None
    for c in store.corrections():
        if c["item_id"] == item_id and c["field"] == "verification":
            if upto_corr is not None and c["corr_seq"] > upto_corr:
                continue
            last = c
    if last:
        v = last["new_value"]
        if v == "confirmed":
            status, basis = "人工核對上架", last["by"]
        elif v == "rejected":
            status, basis = "已排除", last["by"]
        else:
            status, basis = "待審", f"unverifiable({last['by']})"
    return {"verification_status": status, "verification_basis": basis,
            "correction_seq": last["corr_seq"] if last else None}


def corr_limit_for_seq(store: Store, seq: Optional[int]) -> Optional[int]:
    """at_seq 凍結：只套用「該 seq 之前最後一個批次建立時」已存在的更正。"""
    if seq is None:
        return None
    batch_ids = []
    for e in store.events():
        if e["seq"] > seq:
            break
        if e.get("batch_id") and (not batch_ids or batch_ids[-1] != e["batch_id"]):
            batch_ids.append(e["batch_id"])
    if not batch_ids:
        return 0
    b = store.get_batch(batch_ids[-1])
    return (b or {}).get("corr_seq_after", 0)


def item_view(store: Store, item_id: str, at_seq: Optional[int] = None) -> Optional[Dict[str, Any]]:
    st = store.state_at(at_seq)
    h = st["items"].get(item_id)
    if not h:
        w = st["withdrawn"].get(item_id)
        return {"id": item_id, "withdrawn": True, "reason": w, "at_seq": st["seq"]} if w else None
    obj = store.get_object(h)
    if obj is None:
        return None
    v = dict(obj)
    v["content_hash"] = h
    v["event_seq"] = st["item_rev"].get(item_id)
    limit = corr_limit_for_seq(store, at_seq)
    v.update(verification_label(store, item_id, limit))
    corrected = {}
    for c in store.corrections():
        if limit is not None and c["corr_seq"] > limit:
            continue
        if c["item_id"] == item_id and c["field"] != "verification" and c.get("kind") == "field":
            corrected[c["field"]] = c["new_value"]
    if corrected:
        v.update(corrected)
        v["corrected_fields"] = sorted(corrected)
    v["review_notice"] = "新資料一律待審；machine_sentiment 非民調；engagement null=未知"
    return v
