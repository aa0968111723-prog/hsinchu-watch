# -*- coding: utf-8 -*-
"""Compute footer source_status from PUBLISHED items/polls/stats (no hardcoded counts).

Used at finalize time (scripts/finalize_data.py) so dist/data/stats.json carries
source_status for footerHTML. Counts always come from the JSON passed in.
"""
from __future__ import annotations
from typing import Any, Dict, List, Mapping, Optional, Sequence


def _count_platform(items: Sequence[Mapping[str, Any]], platform: str) -> int:
    return sum(1 for i in items if i.get("platform") == platform)


def _latest_platform(items: Sequence[Mapping[str, Any]], platform: str) -> Optional[str]:
    times = [
        (i.get("collected_at") or i.get("published_at"))
        for i in items
        if i.get("platform") == platform and (i.get("collected_at") or i.get("published_at"))
    ]
    return max(times) if times else None


def _count_source_name(items: Sequence[Mapping[str, Any]], name: str) -> int:
    return sum(1 for i in items if i.get("source_name") == name)


def _feed_ok(stats: Mapping[str, Any], feed_key: str) -> int:
    feeds = ((stats.get("source_stats") or {}).get("cna") or {}).get("feeds") or {}
    v = feeds.get(feed_key)
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def compute_source_status(
    items: Sequence[Mapping[str, Any]],
    polls: Sequence[Mapping[str, Any]],
    stats: Mapping[str, Any],
) -> List[Dict[str, Any]]:
    """Return ordered source_status rows for the footer (v5b wording)."""
    ss = stats.get("source_stats") or {}
    rows: List[Dict[str, Any]] = []

    def add(**kw: Any) -> None:
        rows.append(kw)

    # --- Currently advertised collectors (footer group A) ---
    for sid, label, feed_key in (
        ("cna_atom", "中央社 Atom", "cna_atom"),
        ("udn_local", "聯合新聞網·地方 RSS", "udn_local"),
        ("udn_opinion", "聯合新聞網·意見 RSS", "udn_opinion"),
        ("mirrormedia", "鏡週刊 RSS", "mirrormedia"),
    ):
        n_items = 0
        _by_name = {"udn_local": "聯合新聞網·地方", "udn_opinion": "聯合新聞網·鳴人堂", "mirrormedia": "鏡週刊"}
        if sid in _by_name:  # 以發布後 items 的 source_name 計（不用 raw feed 數）
            n_items = sum(1 for i in items if str(i.get("source_name") or "").startswith(_by_name[sid]))
        if sid == "cna_atom":
            n_items = sum(
                1
                for i in items
                if "中央社" in str(i.get("source_name") or "")
                or "cna.com.tw" in str(i.get("url") or "")
            )
        feed_n = _feed_ok(stats, feed_key)
        empty = n_items == 0 and feed_n == 0
        add(
            id=sid,
            label=label,
            group="active_collectors",
            status="empty" if empty else "active",
            status_text=("目前 0 篇，暫停顯示" if empty else f"目前 {n_items or feed_n} 篇"),
            count=n_items,
            last_updated=None,
            reason=None if not empty else f"feeds.{feed_key}=0 且發布 items 無對應列",
        )

    def _ptt_board(board: str) -> list:
        needle_src = f"PTT {board}"
        needle_url = f"/bbs/{board}/"
        return [
            i for i in items
            if i.get("platform") == "ptt"
            and (
                str(i.get("source_name") or "") == needle_src
                or needle_url in str(i.get("url") or "")
                or str(i.get("board") or "") == board
            )
        ]

    for board, label, sid in (
        ("Hsinchu", "PTT 新竹板", "ptt_hsinchu"),
        ("Gossiping", "PTT 八卦板", "ptt_gossiping"),
    ):
        rows = _ptt_board(board)
        n = len(rows)
        times = [
            (i.get("collected_at") or i.get("published_at"))
            for i in rows
            if i.get("collected_at") or i.get("published_at")
        ]
        add(
            id=sid,
            label=label,
            group="active_collectors",
            status="active" if n else "empty",
            status_text=(f"目前 {n} 篇" if n else "目前 0 篇，暫停顯示"),
            count=n,
            last_updated=max(times) if times else None,
            reason=None,
        )

    ly = ss.get("ly") or {}
    ly_n = _count_platform(items, "ly")
    ly_err = ly.get("error")
    if ly_err or ly_n == 0:
        add(
            id="ly",
            label="立法院開放資料",
            group="active_collectors",
            status="error" if ly_err else "empty",
            status_text="目前 0 篇，暫停顯示",
            count=ly_n,
            last_updated=None,
            reason=str(ly_err) if ly_err else "發布 items 無 ly 列",
        )
    else:
        add(
            id="ly",
            label="立法院開放資料",
            group="active_collectors",
            status="active",
            status_text=f"目前 {ly_n} 篇",
            count=ly_n,
            last_updated=_latest_platform(items, "ly"),
            reason=None,
        )

    web_n = _count_platform(items, "website")
    add(
        id="websites",
        label="候選人官網",
        group="active_collectors",
        status="empty" if web_n == 0 else "active",
        status_text=("暫無文章頁（待 sitemap）" if web_n == 0 else f"目前 {web_n} 篇"),
        count=web_n,
        last_updated=_latest_platform(items, "website"),
        reason=("發布 items 中 platform=website 為 0；待 sitemap 收文章頁" if web_n == 0 else None),
    )

    council_n = _count_platform(items, "council")
    add(
        id="council",
        label="新竹縣議會／縣府公開頁",
        group="active_collectors",
        status="active" if council_n else "empty",
        status_text=(f"目前 {council_n} 篇" if council_n else "目前 0 篇，暫停顯示"),
        count=council_n,
        last_updated=_latest_platform(items, "council"),
        reason=None,
    )

    # --- History / disabled ---
    gn = _count_source_name(items, "Google News")
    add(
        id="google_news",
        label="Google News（已停止新抓取）",
        group="history",
        status="disabled_carry",
        status_text=f"歷史保留 {gn} 篇；新抓取已停",
        count=gn,
        last_updated=_latest_platform(items, "news"),
        reason=(ss.get("google_news") or {}).get("disabled") or "robots.txt",
    )

    verified = [p for p in polls if p.get("verified")]
    verified_groups = len(verified)
    verified_reports = sum(int(p.get("report_count") or 1) for p in verified)
    add(
        id="polls",
        label="民調（核可數字）",
        group="history",
        status="active" if verified_reports else "empty",
        status_text=(
            f"核可數字 {verified_reports} 則（合併顯示 {verified_groups} 組）；polls 列表共 {len(polls)} 筆"
            if verified_reports
            else "目前 0 篇，暫停顯示"
        ),
        count=len(polls),
        verified_figure_reports=verified_reports,
        verified_groups=verified_groups,
        last_updated=None,
        reason=(ss.get("polls") or {}).get("disabled"),
    )

    com_n = _count_platform(items, "commentary")
    add(
        id="commentary",
        label="媒體評論（歷史保留）",
        group="history",
        status="disabled_carry",
        status_text=f"歷史保留 {com_n} 篇；新抓取已停",
        count=com_n,
        last_updated=_latest_platform(items, "commentary"),
        reason=(ss.get("commentary") or {}).get("disabled") or "robots.txt",
    )

    yt = ss.get("youtube") or {}
    add(
        id="youtube",
        label="YouTube",
        group="history",
        status="disabled",
        status_text="目前 0 篇，未啟用",
        count=_count_platform(items, "youtube"),
        last_updated=None,
        reason=yt.get("disabled") or "未啟用",
    )

    xm = ss.get("x_mentions") or {}
    add(
        id="x_mentions",
        label="X 提及",
        group="history",
        status="skipped" if xm.get("skipped") else "disabled",
        status_text="目前 0 篇，未啟用",
        count=_count_platform(items, "x"),
        last_updated=None,
        reason=xm.get("reason") or xm.get("disabled") or "未啟用",
    )

    return rows


def render_source_status_html(rows: Sequence[Mapping[str, Any]], *, escape_html) -> str:
    """Minimal HTML fragment (server-side / test). escape_html(str)->str required."""
    icons = {
        "active": "✓",
        "empty": "○",
        "error": "!",
        "disabled": "–",
        "disabled_carry": "◉",
        "skipped": "–",
        "pending": "?",
    }
    parts = ['<ul class="source-status-list">']
    for r in rows:
        st = str(r.get("status") or "pending")
        icon = icons.get(st, "?")
        label = escape_html(str(r.get("label") or ""))
        text = escape_html(str(r.get("status_text") or "狀態待確認"))
        reason = r.get("reason")
        reason_h = (
            f'<div class="source-status-reason">{escape_html(str(reason))}</div>' if reason else ""
        )
        parts.append(
            f'<li class="source-status-item" data-source-id="{escape_html(str(r.get("id") or ""))}">'
            f'<span class="source-status-name">{label}</span> '
            f'<span class="source-status-pill source-status-{escape_html(st)}">'
            f'<span class="source-status-icon" aria-hidden="true">{icon}</span>'
            f'<span class="source-status-text">{text}</span></span>'
            f"{reason_h}</li>"
        )
    parts.append("</ul>")
    return "".join(parts)
