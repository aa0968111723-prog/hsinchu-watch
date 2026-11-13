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
    v.update(verification_label(store, item_id))
    corrected = {}
    for c in store.corrections():
        if c["item_id"] == item_id and c["field"] != "verification" and c.get("kind") == "field":
            corrected[c["field"]] = c["new_value"]
    if corrected:
        v.update(corrected)
        v["corrected_fields"] = sorted(corrected)
    v["review_notice"] = "新資料一律待審；machine_sentiment 非民調；engagement null=未知"
    return v
