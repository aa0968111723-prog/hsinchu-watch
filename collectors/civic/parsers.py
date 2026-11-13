"""Parsers for public feeds. They keep short excerpts and drop accounts."""
from __future__ import annotations

import hashlib
import html
import json
import re
import urllib.request
from urllib.parse import urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree

from collectors.civic.catalog import UA

from collectors.civic.textutil import public_excerpt, parse_published, strip_html

MAX_ITEMS = 12


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def children(element, name: str):
    return [child for child in list(element) if local(child.tag) == name]


def canonical_url(url: str, base: str) -> str:
    joined = urljoin(base, html.unescape(url or "").strip())
    parts = urlsplit(joined)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return ""
    path = parts.path or "/"
    return urlunsplit((parts.scheme, parts.netloc.lower(), path, parts.query, ""))


def _item_from(spec: dict, *, title: str, url: str, excerpt: str, published: str | None,
               precision: str | None, native_id: str = "") -> dict | None:
    clean_title = public_excerpt(title, 180)
    clean_url = canonical_url(url, spec["url"])
    if not clean_title or not clean_url:
        return None
    return {
        "title": clean_title,
        "source_url": clean_url,
        "text_excerpt": public_excerpt(excerpt or clean_title),
        "published_at": published,
        "date_precision": precision,
        "native_id": native_id,
        "region_refs": list(spec["region_ids"]),
        "office_id": spec.get("office_id"),
        "claim_origin": spec["claim_origin"],
        "kind": spec["record_kind"],
    }


def xml_root(body: bytes):
    if body.startswith(b"\xef\xbb\xbf"):
        body = body[3:]
    return ElementTree.fromstring(body)


def parse_rss(spec: dict, body: bytes) -> list[dict]:
    root = xml_root(body)
    found = []
    for item in root.iter():
        if local(item.tag) != "item":
            continue
        title = ""
        link = ""
        description = ""
        pub = ""
        guid = ""
        for child in list(item):
            name = local(child.tag)
            text = "".join(child.itertext()).strip()
            if name == "title" and text and not title:
                title = text
            elif name == "link" and text and not link:
                link = text
            elif name == "description" and text and not description:
                description = text
            elif name in {"pubDate", "date"} and text and not pub:
                pub = text
            elif name == "guid" and text and not guid:
                guid = text
        published, precision = parse_published(pub)
        row = _item_from(
            spec, title=title, url=link or guid, excerpt=description or title,
            published=published, precision=precision,
        )
        if row:
            found.append(row)
        if len(found) >= MAX_ITEMS:
            break
    return found


def _atom_link(entry) -> str:
    links = children(entry, "link")
    chosen = ""
    for link in links:
        href = link.attrib.get("href") or ""
        rel = link.attrib.get("rel") or "alternate"
        if rel == "alternate" and href:
            return href
        if href and not chosen:
            chosen = href
    return chosen


def _atom_entries(spec: dict, body: bytes, *, use_summary: bool, limit: int = MAX_ITEMS) -> list[dict]:
    root = xml_root(body)
    found = []
    for entry in root.iter():
        if local(entry.tag) != "entry":
            continue
        title = "".join(next(iter(children(entry, "title")), ElementTree.Element("title")).itertext())
        summary = ""
        if use_summary:
            node = next(iter(children(entry, "summary")), None) or next(iter(children(entry, "content")), None)
            if node is not None:
                summary = "".join(node.itertext())
        published_raw = ""
        for name in ("published", "updated"):
            node = next(iter(children(entry, name)), None)
            if node is not None and "".join(node.itertext()).strip():
                published_raw = "".join(node.itertext())
                break
        published, precision = parse_published(published_raw)
        row = _item_from(
            spec, title=title, url=_atom_link(entry), excerpt=summary or title,
            published=published, precision=precision,
        )
        if row:
            found.append(row)
        if len(found) >= limit:
            break
    return found


def parse_atom_title(spec: dict, body: bytes) -> list[dict]:
    return _atom_entries(spec, body, use_summary=False)


def parse_atom_keywords(spec: dict, body: bytes) -> list[dict]:
    keywords = spec.get("keywords") or []
    rows = []
    for row in _atom_entries(spec, body, use_summary=True, limit=80):
        blob = row["title"] + row["text_excerpt"]
        if keywords and not any(word in blob for word in keywords):
            continue
        row["region_refs"] = _regions_for_text(blob)
        rows.append(row)
        if len(rows) >= MAX_ITEMS:
            break
    return rows


def _regions_for_text(text: str) -> list[str]:
    regions = []
    if "新北" in text:
        regions.append("new-taipei")
    if "臺北" in text or "台北" in text:
        regions.append("taipei")
    if "新竹市" in text or "香山" in text:
        regions.append("hsinchu-city")
    if "新竹縣" in text or "竹北" in text:
        regions.append("hsinchu-county")
    if "新竹" in text and "hsinchu-city" not in regions and "hsinchu-county" not in regions:
        regions.append("hsinchu")
    if any(word in text for word in ("行政院", "立法院", "主計總處")):
        regions.append("central")
    return regions or ["taiwan"]


def parse_ey_html(spec: dict, body: bytes) -> list[dict]:
    text = body.decode("utf-8", "replace")
    pattern = re.compile(
        r'href="(/Page/[^"]+)"[^>]*title="([^"]*)"[^>]*>\s*'
        r'<span class="newsDate2">([^<]*)</span>\s*<span class="newsTitle2">([^<]*)</span>',
        re.I | re.S,
    )
    found = []
    for href, title_attr, date_text, title in pattern.findall(text):
        published, precision = parse_published(date_text)
        row = _item_from(
            spec, title=title or title_attr, url=href, excerpt=title or title_attr,
            published=published, precision=precision,
        )
        if row:
            found.append(row)
        if len(found) >= MAX_ITEMS:
            break
    return found


def parse_hccg_html(spec: dict, body: bytes) -> list[dict]:
    text = body.decode("utf-8", "replace")
    patterns = [
        re.compile(
            r'href="(/hccg/app/data/view\?module=municipalnews[^"]+)"[^>]*title="([^"]*)"[^>]*>\s*'
            r'<span class="date">([^<]*)</span>',
            re.I | re.S,
        ),
        re.compile(
            r'href="(/hccg/app/data/view\?module=municipalnews[^"]+)"(?:(?!href=).)*?'
            r"<h3>\s*(.*?)\s*</h3>\s*<div class=\"griddate\">\s*([^<]+?)\s*</div>",
            re.I | re.S,
        ),
    ]
    found = []
    seen = set()
    for pattern in patterns:
        for href, title, date_text in pattern.findall(text):
            url = canonical_url(href, spec["url"])
            if not url or url in seen:
                continue
            seen.add(url)
            published, precision = parse_published(date_text)
            row = _item_from(
                spec, title=strip_html(title), url=url, excerpt=strip_html(title),
                published=published, precision=precision,
            )
            if row:
                found.append(row)
            if len(found) >= MAX_ITEMS:
                return found
    return found


def parse_ntpc_json(spec: dict, body: bytes) -> list[dict]:
    payload = json.loads(body.decode("utf-8-sig"))
    rows = payload if isinstance(payload, list) else []
    found = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        native = str(row.get("id") or "")
        published, precision = parse_published(str(row.get("startDate") or ""))
        if published is None and re.fullmatch(r"20\d{6}", native[:8] if len(native) >= 8 else ""):
            published = f"{native[:4]}-{native[4:6]}-{native[6:8]}"
            precision = "day"
        item = _item_from(
            spec,
            title=str(row.get("title") or ""),
            url=spec.get("list_url") or spec["url"],
            excerpt=str(row.get("description") or row.get("title") or ""),
            published=published,
            precision=precision,
            native_id=native,
        )
        if item:
            item["data_class"] = public_excerpt(str(row.get("dataClass") or ""), 40) or None
            found.append(item)
        if len(found) >= 8:
            break
    return found


def _ly_rows(payload) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("jsonList", "dataList", "data", "result"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def parse_ly_json(spec: dict, body: bytes) -> list[dict]:
    payload = json.loads(body.decode("utf-8-sig"))
    found = []
    for row in _ly_rows(payload):
        if not isinstance(row, dict):
            continue
        title = str(row.get("meetingName") or row.get("meetingTypeName") or "立法院會議")
        date_text = str(row.get("meetingDate") or "")
        speaker = str(row.get("legislatorName") or row.get("委員姓名") or "").strip()
        content = str(row.get("meetingContent") or "")
        video = str(row.get("videoUrl") or row.get("speechRecordUrl") or "")
        published, precision = parse_published(date_text)
        excerpt = " ".join(part for part in (f"資料集所載委員：{speaker}" if speaker else "", content) if part)
        native = hashlib.sha256("|".join((date_text, speaker, title, video)).encode("utf-8")).hexdigest()[:16]
        item = _item_from(
            spec,
            title=title,
            url=video if video.startswith("https://") else spec["url"],
            excerpt=excerpt or title,
            published=published,
            precision=precision,
            native_id=native,
        )
        if item:
            found.append(item)
        if len(found) >= MAX_ITEMS:
            break
    return found


def _pcc_region(org: str) -> str | None:
    if org.startswith(("臺北市", "台北市")):
        return "taipei"
    if org.startswith("新北市"):
        return "new-taipei"
    if org.startswith("新竹縣"):
        return "hsinchu-county"
    if org.startswith("新竹市"):
        return "hsinchu-city"
    return None


def _pcc_date(value: str) -> tuple[str | None, str | None]:
    match = re.fullmatch(r"(\d{4})/(\d{2})/(\d{2})", (value or "").strip())
    if not match:
        return None, None
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}", "day"


def _bounded_get(url: str, limit: int = 1_500_000) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read(limit + 1)
    if len(body) > limit:
        raise RuntimeError(f"response_truncated>{limit}")
    return body


def _rows_from_tender_xml(spec: dict, text: str, file_url: str) -> list[dict]:
    root = xml_root(text.encode("utf-8"))
    counts = {"taipei": 0, "new-taipei": 0, "hsinchu-county": 0, "hsinchu-city": 0}
    found = []
    for tender in root.iter():
        if local(tender.tag) != "TENDER":
            continue
        fields = {local(child.tag): "".join(child.itertext()).strip() for child in list(tender)}
        org = fields.get("TENDER_ORG_NAME") or ""
        region = _pcc_region(org)
        if region is None or counts[region] >= 3:
            continue
        title = fields.get("TENDER_NAME") or ""
        case_no = fields.get("TENDER_CASE_NO") or ""
        published, precision = _pcc_date(fields.get("AWARD_DATE") or fields.get("TENDER_SPDT") or "")
        price = fields.get("TENDER_AWARD_PRICE") or ""
        price_note = f"資料檔所載決標金額 {price} 元，不是支用或驗收。" if price else "這份列沒有金額，不補 0。"
        excerpt = "。".join(part for part in (org, fields.get("PROCUREMENT_TYPE"), fields.get("PROCUREMENT_ATTR"), f"案號 {case_no}" if case_no else "") if part)
        excerpt = f"{excerpt}。{price_note}"
        row = _item_from(
            spec,
            title=title,
            url=file_url,
            excerpt=excerpt,
            published=published,
            precision=precision,
            native_id=case_no or title,
        )
        if not row:
            continue
        row["region_refs"] = [region]
        counts[region] += 1
        found.append(row)
        if len(found) >= MAX_ITEMS:
            break
    return found


def parse_pcc_tenders(spec: dict, body: bytes) -> list[dict]:
    text = body.decode("utf-8-sig", "replace")
    if "<TENDER" in text:
        return _rows_from_tender_xml(spec, text, spec.get("list_url") or spec["url"])
    names = re.findall(r"fileName=(award_\d+\.xml)", text)
    if not names:
        raise RuntimeError("pcc_index_missing_file")
    file_url = "https://web.pcc.gov.tw/tps/tp/OpenData/downloadFile?fileName=" + names[0]
    payload = _bounded_get(file_url).decode("utf-8-sig", "replace")
    return _rows_from_tender_xml(spec, payload, file_url)


def parse_hsc_final_account(spec: dict, body: bytes) -> list[dict]:
    payload = json.loads(body.decode("utf-8-sig"))
    rows = [row for row in payload if isinstance(row, dict) and str(row.get("年度") or "").strip()]
    rows.sort(key=lambda row: int(str(row.get("年度"))))
    found = []
    for row in rows[-4:]:
        roc = int(str(row.get("年度")))
        year = roc + 1911 if roc < 1911 else roc
        total = row.get("歲出決算數")
        if total is None or str(total).strip() == "":
            amount = None
            amount_note = "歲出決算數欄位是空的，不補 0。"
        else:
            amount = str(total).strip()
            amount_note = f"資料檔歲出決算數為 {amount}。單位未在欄名標示，不換算。"
        item = _item_from(
            spec,
            title=f"新竹縣{year}年度歲出決算",
            url=spec.get("list_url") or spec["url"],
            excerpt=f"新竹縣政府歲出決算。{amount_note}這是機關決算數，不是驗收或成效。",
            published=f"{year:04d}",
            precision="year",
            native_id=str(year),
        )
        if item:
            item["reported_total"] = amount
            found.append(item)
    return found


PARSERS = {
    "rss": parse_rss,
    "atom_title": parse_atom_title,
    "atom_keywords": parse_atom_keywords,
    "ey_html": parse_ey_html,
    "hccg_html": parse_hccg_html,
    "ntpc_json": parse_ntpc_json,
    "ly_json": parse_ly_json,
    "pcc_tender_xml": parse_pcc_tenders,
    "hsc_final_json": parse_hsc_final_account,
}

