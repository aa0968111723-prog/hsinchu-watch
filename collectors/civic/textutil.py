"""Text and date helpers. Unknown stays null; contact details are dropped."""
from __future__ import annotations

import html
import re
from datetime import datetime
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Taipei")
EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?:\+?886[-\s]?)?(?:0\d{1,3}[-\s)]?\d{3,4}[-\s]?\d{3,4}|09\d{2}[-\s]?\d{3}[-\s]?\d{3})")
TAG = re.compile(r"<[^>]+>")
CUT = re.compile(r"(資料詳洽|新聞聯絡|新聞連絡|承辦人|聯絡人|聯絡窗口)")


def now_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(TZ).isoformat(timespec="seconds")


def strip_html(value: str) -> str:
    text = TAG.sub(" ", html.unescape(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def public_excerpt(value: str, limit: int = 180) -> str:
    text = strip_html(value)
    text = CUT.split(text, maxsplit=1)[0]
    text = EMAIL.sub("[聯絡方式已省略]", text)
    text = PHONE.sub("[電話已省略]", text)
    text = re.sub(r"\s+", " ", text).strip(" ；;，,")
    if len(text) > limit:
        return text[:limit].rstrip() + "…"
    return text


def parse_rfc822(value: str) -> tuple[str | None, str | None]:
    raw = (value or "").strip()
    if not raw:
        return None, None
    try:
        parsed = parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None, None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TZ)
    return now_iso(parsed), "minute"


def parse_roc_date(value: str) -> tuple[str | None, str | None]:
    text = value or ""
    match = re.search(r"(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})", text)
    if not match:
        match = re.search(r"(?<!\d)(\d{2,3})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)", text)
    if not match:
        return None, None
    year, month, day = (int(match.group(i)) for i in range(1, 4))
    if year < 1911:
        year += 1911
    try:
        datetime(year, month, day)
    except ValueError:
        return None, None
    return f"{year:04d}-{month:02d}-{day:02d}", "day"


def parse_mdy(value: str) -> tuple[str | None, str | None]:
    match = re.fullmatch(r"\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*", value or "")
    if not match:
        return None, None
    month, day, year = (int(match.group(i)) for i in range(1, 4))
    try:
        datetime(year, month, day)
    except ValueError:
        return None, None
    return f"{year:04d}-{month:02d}-{day:02d}", "day"


def parse_published(value: str | None) -> tuple[str | None, str | None]:
    if not value or not str(value).strip():
        return None, None
    text = str(value).strip()
    roc, precision = parse_roc_date(text)
    if roc and re.search(r"年|民國|^\d{2,3}[-/.]", text):
        return roc, precision
    mdy, precision = parse_mdy(text)
    if mdy:
        return mdy, precision
    stamp, precision = parse_rfc822(text)
    if stamp:
        return stamp, precision
    iso = re.fullmatch(r"(\d{4}-\d{2}-\d{2})(?:[T ].*)?", text)
    if iso:
        day = iso.group(1)
        if "T" in text or ":" in text:
            try:
                parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            except ValueError:
                return day, "day"
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=TZ)
            return now_iso(parsed), "minute"
        return day, "day"
    return None, None
