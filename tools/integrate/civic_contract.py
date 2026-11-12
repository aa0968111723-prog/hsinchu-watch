"""Validate civic source, record, project and geography records."""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
SECTIONS_PATH = ROOT / "src" / "lib" / "civic-sections.json"
CLAIM_ORIGINS = {
    "claim", "agency_release", "report", "opinion", "question",
    "response", "factcheck", "judicial", "unknown",
}
VERIFICATION = {"unreviewed", "reported", "corroborated", "contested", "unknown"}
WEAK_BASIS = {"http_status", "rss_index", "report_digest"}
HEALTH = {"unknown", "ok", "stale", "failed", "blocked"}
LOCATION = {"site", "street", "area", "unknown"}
FAKE_BASIS = {"city_center", "region_centroid", "invented"}
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?")
MONTH_RE = re.compile(r"\d{4}-\d{2}")


def civic_sections():
    data = json.loads(SECTIONS_PATH.read_text(encoding="utf-8"))
    if data.get("label") != "公共事務" or not data.get("sections"):
        raise ValueError("Civic section list is empty")
    return data


def _present(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Missing " + label)


def _optional_time(value, label):
    if value is None:
        return
    if not isinstance(value, str):
        raise ValueError("Invalid " + label)
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    if DATE_RE.fullmatch(value) and "T" in value:
        datetime.fromisoformat(text)
        return
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        date.fromisoformat(value)
        return
    if MONTH_RE.fullmatch(value):
        date.fromisoformat(value + "-01")
        return
    raise ValueError("Invalid " + label)


def _https(value, label):
    _web(value, label, https_only=True)


def _web(value, label, https_only=False):
    url = urlsplit(value or "")
    schemes = ("https",) if https_only else ("https", "http")
    if url.scheme not in schemes or not url.hostname or url.username or url.password:
        raise ValueError("Invalid " + label)


def validate_source(source):
    _present(source.get("id"), "source id")
    _present(source.get("name"), "source name")
    _present(source.get("kind"), "source kind")
    _https(source.get("url"), "source url")
    if not isinstance(source.get("region_ids"), list):
        raise ValueError("source region_ids must be a list")
    _present(source.get("access_method"), "access method")
    if "coverage_note" not in source:
        raise ValueError("Missing coverage note")
    for field in ("last_attempt_at", "last_success_at", "next_due_at"):
        _optional_time(source.get(field), field)
    if source.get("health") not in HEALTH:
        raise ValueError("Invalid source health")
    if source.get("health") == "ok" and not source.get("last_success_at"):
        raise ValueError("Healthy source needs last_success_at")
    return source


def validate_record(record):
    _present(record.get("id"), "record id")
    _present(record.get("kind"), "record kind")
    if record.get("claim_origin") not in CLAIM_ORIGINS:
        raise ValueError("Invalid claim origin")
    if record.get("verification_status") not in VERIFICATION:
        raise ValueError("Invalid verification status")
    if record.get("verification_status") == "corroborated" and record.get("verification_basis") in WEAK_BASIS | {None}:
        raise ValueError("HTTP or index success cannot corroborate a record")
    if not isinstance(record.get("stats_eligible"), bool):
        raise ValueError("stats_eligible must be boolean")
    if "responded" in record or "person_did_not_respond" in record:
        raise ValueError("A missing reply is not evidence the person never responded")
    for field in ("published_at", "collected_at", "checked_at"):
        _optional_time(record.get(field), field)
    if record.get("source_url") is not None:
        _web(record.get("source_url"), "record source url")
    if not isinstance(record.get("actor_refs"), list) or not isinstance(record.get("region_refs"), list):
        raise ValueError("Record refs must be lists")
    return record


def validate_project(project):
    _present(project.get("id"), "project id")
    _present(project.get("title"), "project title")
    _present(project.get("region_id"), "project region")
    budget = project.get("budget") or {}
    for key in ("approved_twd", "contract_twd", "spent_twd"):
        value = budget.get(key)
        if value is not None and (type(value) is not int or value < 0):
            raise ValueError("Invalid project budget")
    progress = project.get("progress")
    if progress is not None:
        if type(progress.get("value")) not in (int, float) or not 0 <= progress["value"] <= 100:
            raise ValueError("Invalid reported progress")
        if progress.get("means") != "reported_progress":
            raise ValueError("Progress is not acceptance or outcome")
    for field in ("acceptance", "operation", "outcome"):
        value = project.get(field)
        if value is not None and not value.get("evidence_refs"):
            raise ValueError(field + " needs its own evidence")
    if not isinstance(project.get("missing_evidence"), list):
        raise ValueError("missing_evidence must be a list")
    return project


def validate_geography(row):
    _present(row.get("id"), "geography id")
    if row.get("location_precision") not in LOCATION:
        raise ValueError("Invalid location precision")
    geometry = row.get("geometry")
    if geometry is None:
        if row.get("location_precision") != "unknown" or row.get("coordinate_source") is not None:
            raise ValueError("Missing geometry stays unknown")
        return row
    if geometry.get("type") != "Point" or len(geometry.get("coordinates") or []) != 2:
        raise ValueError("Geography uses a GeoJSON point")
    lon, lat = geometry["coordinates"]
    if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
        raise ValueError("Coordinates must be numbers")
    if not -180 <= lon <= 180 or not -90 <= lat <= 90:
        raise ValueError("Coordinates out of range")
    if row.get("location_precision") == "unknown":
        raise ValueError("A point needs a location precision")
    source = row.get("coordinate_source") or {}
    _https(source.get("url"), "coordinate source")
    _optional_time(source.get("checked_at"), "coordinate checked_at")
    if not source.get("checked_at") or source.get("basis") in FAKE_BASIS | {None}:
        raise ValueError("City center is not a site coordinate")
    return row
