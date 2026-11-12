# -*- coding: utf-8 -*-
"""立法院開放資料（僅徐欣瑩）。SSL 失敗時標記錯誤，不中斷整體。"""
from __future__ import annotations
from datetime import datetime
from collectors.config import ID_TO_PERSON, LY_ID421, REQUEST_TIMEOUT
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item, session, to_iso_tw

def _parse_rows(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("jsonList", "dataList", "data", "result"):
            if isinstance(data.get(k), list):
                return data[k]
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    return []

def _roc_to_iso(date_s: str):
    try:
        s = str(date_s).replace("-", "/")
        parts = s.split("/")
        if len(parts) != 3:
            return None
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
        if y < 1911:
            y += 1911
        return to_iso_tw(datetime(y, m, d))
    except Exception:
        return None

def collect():
    sess = session()
    items, stats = [], {"ok": 0, "error": None, "raw": 0, "attempts": []}
    person = ID_TO_PERSON["xu"]
    periods = [
        ("4", "114/02/01", "114/07/31"),
        ("3", "113/09/01", "114/01/31"),
        ("2", "113/02/01", "113/07/31"),
        ("1", "112/09/01", "113/01/31"),
    ]
    try:
        for period, start, end in periods:
            url = LY_ID421.format(period=period, start=start, end=end)
            try:
                r = sess.get(url, timeout=REQUEST_TIMEOUT)
                r.raise_for_status()
                rows = _parse_rows(r.json())
                stats["attempts"].append({"period": period, "n": len(rows)})
                stats["raw"] += len(rows)
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    name = str(row.get("legislatorName") or row.get("委員姓名") or "")
                    if name and "徐欣瑩" not in name:
                        continue
                    title = str(row.get("meetingName") or row.get("meetingTypeName") or "立法院發言")
                    date_s = str(row.get("meetingDate") or "")
                    video = str(row.get("videoUrl") or row.get("speechRecordUrl") or "https://ivod.ly.gov.tw/Demand")
                    content = str(row.get("meetingContent") or "")
                    items.append(make_item(
                        person=person, platform="ly", source_name="立法院開放資料",
                        url=video, title=f"徐欣瑩｜{title}",
                        summary=content[:300] or f"{title} {date_s}",
                        published_at=_roc_to_iso(date_s),
                        is_own_speech=True, sentiment_fn=score_sentiment, topics_fn=tag_topics,
                    ))
            except Exception as ex:
                stats["attempts"].append({"period": period, "error": str(ex)[:200]})
        stats["ok"] = len(items)
        if not items and stats["attempts"]:
            if any("error" in a for a in stats["attempts"]):
                stats["error"] = "立法院 API 連線失敗（見 attempts）"
            else:
                stats["note"] = "立法院 API 連線正常，但查詢回 0 筆（資料集／參數，非 SSL）"
    except Exception as ex:
        stats["error"] = str(ex)
    return items, stats
