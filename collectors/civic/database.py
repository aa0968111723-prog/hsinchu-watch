"""Build a queryable SQLite database without rewriting legacy JSON.

Articles, source-index rows, policies, threads and comments stay in separate
tables. Commenter account ids are not copied. Missing numbers stay NULL.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

from collectors.civic.cycle import civic_dir

SCHEMA = """
PRAGMA foreign_keys = OFF;

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE payload_files (
  path TEXT PRIMARY KEY,
  bytes INTEGER,
  rows INTEGER,
  role TEXT
);

CREATE TABLE regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  precision TEXT
);

CREATE TABLE offices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region_id TEXT,
  kind TEXT
);

CREATE TABLE terms (
  id TEXT PRIMARY KEY,
  office_kind TEXT,
  starts_on TEXT,
  ends_on TEXT,
  holder_actor_id TEXT,
  basis TEXT,
  basis_url TEXT
);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  race_id TEXT,
  ballot_number INTEGER,
  roster_source_id TEXT
);

CREATE TABLE races (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE mentioned_people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  on_official_roster INTEGER NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT,
  kind TEXT,
  url TEXT,
  region_ids TEXT,
  access_method TEXT,
  permission TEXT,
  coverage_note TEXT,
  interval_minutes INTEGER,
  date_field TEXT,
  gap TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  next_due_at TEXT,
  health TEXT,
  error TEXT,
  last_http_status INTEGER,
  consecutive_failures INTEGER,
  records_kept INTEGER,
  origin TEXT NOT NULL
);

CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  legacy_file TEXT,
  person_id TEXT,
  title TEXT,
  url TEXT,
  source_name TEXT,
  platform TEXT,
  published_at TEXT,
  collected_at TEXT,
  summary TEXT,
  review_status TEXT,
  counts_in_stats INTEGER,
  tone_label TEXT
);

CREATE TABLE article_topics (
  article_id TEXT,
  topic TEXT,
  PRIMARY KEY (article_id, topic)
);

CREATE TABLE policies (
  id TEXT PRIMARY KEY,
  person_id TEXT,
  title TEXT,
  summary TEXT,
  kind TEXT,
  claim_origin TEXT,
  source_type TEXT,
  source_name TEXT,
  source_url TEXT,
  url TEXT,
  published_at TEXT,
  checked_at TEXT,
  date_precision TEXT,
  note TEXT,
  issues_json TEXT
);

CREATE TABLE source_index (
  id TEXT PRIMARY KEY,
  title TEXT,
  url TEXT,
  published_on TEXT,
  source_name TEXT
);

CREATE TABLE source_index_people (
  source_index_id TEXT,
  person_id TEXT,
  PRIMARY KEY (source_index_id, person_id)
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  url TEXT,
  platform TEXT
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  about_person_id TEXT,
  kind TEXT,
  at TEXT,
  summary TEXT
);

CREATE TABLE polls (
  id TEXT PRIMARY KEY,
  org TEXT,
  label TEXT,
  population TEXT,
  race TEXT,
  scenario TEXT,
  field_start TEXT,
  field_end TEXT,
  published_at TEXT,
  sample_size INTEGER,
  moe REAL,
  numbers_hidden INTEGER,
  note TEXT,
  news_url TEXT,
  support_json TEXT,
  raw_percents_json TEXT
);

CREATE TABLE poll_reports (
  poll_id TEXT,
  url TEXT,
  title TEXT,
  source_name TEXT,
  published_at TEXT
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT,
  region_id TEXT,
  topic_id TEXT,
  agency TEXT,
  phase TEXT,
  phase_as_of TEXT,
  summary TEXT,
  target_value TEXT,
  target_precision TEXT,
  approved_twd INTEGER,
  contract_twd INTEGER,
  spent_twd INTEGER,
  progress_value REAL,
  progress_as_of TEXT,
  geometry TEXT,
  location_precision TEXT
);

CREATE TABLE project_events (
  project_id TEXT,
  event_date TEXT,
  precision TEXT,
  summary TEXT,
  source_id TEXT,
  kind TEXT
);

CREATE TABLE project_missing (
  project_id TEXT,
  evidence TEXT
);

CREATE TABLE issue_stances (
  issue_id TEXT,
  person_id TEXT,
  has_statement TEXT,
  published_at TEXT,
  quote TEXT,
  summary TEXT,
  source_name TEXT,
  source_url TEXT,
  role_at_time TEXT,
  PRIMARY KEY (issue_id, person_id)
);

CREATE TABLE pending_news (
  id TEXT PRIMARY KEY,
  title TEXT,
  url TEXT,
  publisher TEXT,
  reported_publication_time TEXT,
  date_precision TEXT,
  verification_status TEXT,
  review_status TEXT
);

CREATE TABLE civic_records (
  id TEXT PRIMARY KEY,
  kind TEXT,
  source_id TEXT,
  source_url TEXT,
  title TEXT,
  published_at TEXT,
  collected_at TEXT,
  checked_at TEXT,
  date_precision TEXT,
  text_excerpt TEXT,
  claim_origin TEXT,
  verification_status TEXT,
  stats_eligible INTEGER,
  region_refs TEXT,
  actor_refs TEXT
);

CREATE TABLE corrections (
  id TEXT PRIMARY KEY,
  record_id TEXT,
  source_id TEXT,
  changed_at TEXT,
  fields_json TEXT,
  note TEXT
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  window_start TEXT,
  window_end TEXT,
  agency_record_ids TEXT,
  project_ids TEXT,
  support_record_ids TEXT,
  criticism_record_ids TEXT,
  response_record_ids TEXT,
  counterevidence_record_ids TEXT,
  unknown_json TEXT,
  note TEXT
);

CREATE TABLE feed (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  etag TEXT,
  content_hash TEXT,
  generated_at TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  status TEXT,
  stale_after_minutes INTEGER
);
"""


def _read(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _flag(value):
    if value is None:
        return None
    return 1 if value else 0


def _remember(conn, path: Path, root: Path, rows: int | None, role: str) -> None:
    if not path.exists():
        return
    conn.execute(
        "INSERT OR REPLACE INTO payload_files(path, bytes, rows, role) VALUES (?, ?, ?, ?)",
        (path.relative_to(root).as_posix(), path.stat().st_size, rows, role),
    )


def _article_tuple(row: dict, origin: str, legacy: str):
    return (
        str(row.get("id") or ""),
        origin,
        legacy,
        row.get("person_id") or row.get("personId"),
        row.get("title"),
        row.get("url"),
        row.get("source_name"),
        row.get("platform"),
        row.get("published_at"),
        row.get("collected_at"),
        row.get("summary"),
        row.get("review_status"),
        _flag(row.get("counts_in_stats")) if "counts_in_stats" in row else None,
        row.get("sentiment"),
    )


def build_database(root: Path) -> dict:
    data = root / "public" / "data"
    observations = root / "public" / "observations"
    target = civic_dir(root) / "watch.sqlite"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        target.unlink()
    conn = sqlite3.connect(target)
    try:
        conn.executescript(SCHEMA)
        _load_graph(conn, data)
        _load_roster(conn, data)
        article_counts = _load_articles(conn, root, data)
        _load_policies(conn, root, data)
        _load_source_index(conn, root, observations)
        _load_comments(conn, root, observations)
        _load_polls(conn, root, data)
        _load_projects(conn, root, data)
        _load_stances(conn, root, data)
        _load_pending_news(conn, root, data)
        _load_official(conn, root, data)
        _load_civic(conn, data)
        _load_comparisons(conn, data)
        _load_people(conn, observations)
        conn.execute(
            "INSERT INTO meta(key, value) VALUES (?, ?)",
            ("tone_label", "articles.tone_label 沿用既有標記，只是可修正輔助，不能加總成支持度或政治評分。"),
        )
        conn.execute(
            "INSERT INTO meta(key, value) VALUES (?, ?)",
            ("nulls", "spent_twd、progress 與日期缺值保持 NULL，沒有補 0。issue_stances.has_statement 用 present/absent，不用 0 代表零表現。"),
        )
        conn.execute(
            "INSERT INTO meta(key, value) VALUES (?, ?)",
            ("comments", "留言只存討論串、時間與短摘錄。來源 commentId 與作者帳號不寫入。"),
        )
        conn.commit()
        counts = {
            name: conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
            for name in (
                "articles", "policies", "source_index", "comments", "threads",
                "polls", "projects", "candidates", "civic_records", "sources",
                "pending_news", "issue_stances",
            )
        }
        counts.update(article_counts)
        counts["database"] = target.relative_to(root).as_posix()
        return counts
    finally:
        conn.close()


def _load_graph(conn, data: Path) -> None:
    graph = _read(data / "civic" / "graph.json")
    if not graph:
        return
    conn.executemany(
        "INSERT INTO regions(id, name, parent_id, precision) VALUES (?, ?, ?, ?)",
        [(row["id"], row["name"], row.get("parent_id"), row.get("precision")) for row in graph.get("regions") or []],
    )
    conn.executemany(
        "INSERT INTO offices(id, name, region_id, kind) VALUES (?, ?, ?, ?)",
        [(row["id"], row["name"], row.get("region_id"), row.get("kind")) for row in graph.get("offices") or []],
    )
    conn.executemany(
        "INSERT INTO terms(id, office_kind, starts_on, ends_on, holder_actor_id, basis, basis_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(
            row["id"], row.get("office_kind"), row.get("starts_on"), row.get("ends_on"),
            row.get("holder_actor_id"), row.get("basis"), row.get("basis_url"),
        ) for row in graph.get("terms") or []],
    )


def _load_roster(conn, data: Path) -> None:
    roster = _read(data / "candidate-review.json") or {}
    conn.executemany(
        "INSERT INTO races(id, name) VALUES (?, ?)",
        [(row["id"], row["name"]) for row in roster.get("races") or []],
    )
    conn.executemany(
        "INSERT INTO candidates(id, name, race_id, ballot_number, roster_source_id) VALUES (?, ?, ?, ?, ?)",
        [(
            row["id"], row["name"], row.get("race_id"), row.get("ballot_number"), row.get("roster_source_id"),
        ) for row in roster.get("candidates") or []],
    )


def _load_articles(conn, root: Path, data: Path) -> dict:
    path = data / "items.json"
    rows = _read(path) or []
    if not isinstance(rows, list):
        rows = []
    seen = set()
    payload = []
    topics = []
    duplicate_ids = 0
    for row in rows:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        if row["id"] in seen:
            duplicate_ids += 1
            continue
        seen.add(row["id"])
        payload.append(_article_tuple(row, "items", "public/data/items.json"))
        for topic in row.get("topics") or []:
            topics.append((row["id"], str(topic)))
    conn.executemany(
        """INSERT INTO articles(id, origin, legacy_file, person_id, title, url, source_name, platform,
           published_at, collected_at, summary, review_status, counts_in_stats, tone_label)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        payload,
    )
    conn.executemany("INSERT OR IGNORE INTO article_topics(article_id, topic) VALUES (?, ?)", topics)
    _remember(conn, path, root, len(payload), "articles")
    extras = 0
    overlap = 0
    for split in sorted(data.glob("items_*.json")):
        split_rows = _read(split) or []
        extra_payload = []
        if not isinstance(split_rows, list):
            continue
        for row in split_rows:
            if not isinstance(row, dict) or not row.get("id"):
                continue
            if row["id"] in seen:
                overlap += 1
                continue
            seen.add(row["id"])
            extras += 1
            extra_payload.append(_article_tuple(row, "items-extra", split.relative_to(root).as_posix()))
        if extra_payload:
            conn.executemany(
                """INSERT INTO articles(id, origin, legacy_file, person_id, title, url, source_name, platform,
                   published_at, collected_at, summary, review_status, counts_in_stats, tone_label)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                extra_payload,
            )
        _remember(conn, split, root, len(split_rows) if isinstance(split_rows, list) else None, "article-split")
    return {
        "articles_from_items": len(payload),
        "article_duplicate_ids": duplicate_ids,
        "article_split_overlap": overlap,
        "article_split_extras": extras,
    }


def _load_policies(conn, root: Path, data: Path) -> None:
    path = data / "policies.json"
    rows = _read(path) or []
    if not isinstance(rows, list):
        return
    conn.executemany(
        """INSERT INTO policies(id, person_id, title, summary, kind, claim_origin, source_type, source_name,
           source_url, url, published_at, checked_at, date_precision, note, issues_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [(
            row.get("id"), row.get("person_id"), row.get("title"), row.get("summary"), row.get("kind"),
            row.get("claim_origin"), row.get("source_type"), row.get("source_name"), row.get("source_url"),
            row.get("url"), row.get("published_at"), row.get("checked_at"), row.get("date_precision"),
            row.get("note"), json.dumps(row.get("issues"), ensure_ascii=False) if row.get("issues") is not None else None,
        ) for row in rows if isinstance(row, dict) and row.get("id")],
    )
    _remember(conn, path, root, len(rows), "policies")


def _load_source_index(conn, root: Path, observations: Path) -> None:
    path = observations / "sources.json"
    payload = _read(path) or {}
    entries = payload.get("entries") or []
    rows = []
    people = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        identity = f"{index}|{entry.get('url') or ''}|{entry.get('title') or ''}"
        key = "src-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
        rows.append((key, entry.get("title"), entry.get("url"), entry.get("date"), entry.get("source")))
        for person_id in entry.get("personIds") or []:
            people.append((key, person_id))
    conn.executemany(
        "INSERT OR REPLACE INTO source_index(id, title, url, published_on, source_name) VALUES (?, ?, ?, ?, ?)",
        rows,
    )
    conn.executemany(
        "INSERT OR IGNORE INTO source_index_people(source_index_id, person_id) VALUES (?, ?)",
        people,
    )
    _remember(conn, path, root, len(rows), "source-index")


def _load_comments(conn, root: Path, observations: Path) -> None:
    path = observations / "comments.json"
    payload = _read(path) or {}
    thread_ids = {}
    for thread_id, thread in (payload.get("threads") or {}).items():
        if not isinstance(thread, dict):
            continue
        public_id = "thr-" + hashlib.sha256(str(thread.get("url") or thread_id).encode("utf-8")).hexdigest()[:16]
        thread_ids[thread_id] = public_id
        conn.execute(
            "INSERT INTO threads(id, url, platform) VALUES (?, ?, ?)",
            (public_id, thread.get("url"), thread.get("platform")),
        )
    for index, entry in enumerate(payload.get("entries") or []):
        if not isinstance(entry, dict):
            continue
        raw = "|".join(str(entry.get(key) or "") for key in ("thread", "at", "summary")) + f"|{index}"
        comment_key = "cmt-" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
        conn.execute(
            "INSERT INTO comments(id, thread_id, about_person_id, kind, at, summary) VALUES (?, ?, ?, ?, ?, ?)",
            (
                comment_key,
                thread_ids.get(entry.get("thread")),
                entry.get("personId"),
                entry.get("kind"),
                entry.get("at"),
                entry.get("summary"),
            ),
        )
    _remember(conn, path, root, len(payload.get("entries") or []), "anonymous-comments")


def _load_people(conn, observations: Path) -> None:
    payload = _read(observations / "sources.json") or {}
    comments = _read(observations / "comments.json") or {}
    people = {}
    people.update(payload.get("people") or {})
    people.update(comments.get("people") or {})
    roster = {row[0] for row in conn.execute("SELECT id FROM candidates")}
    for person_id, info in people.items():
        if not isinstance(info, dict):
            continue
        conn.execute(
            "INSERT OR REPLACE INTO mentioned_people(id, name, note, on_official_roster) VALUES (?, ?, ?, ?)",
            (person_id, info.get("name") or person_id, info.get("status"), 1 if person_id in roster else 0),
        )


def _load_polls(conn, root: Path, data: Path) -> None:
    path = data / "polls.json"
    rows = _read(path) or []
    if not isinstance(rows, list):
        return
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        poll_id = "poll-" + hashlib.sha256(f"{index}|{row.get('group_key')}".encode("utf-8")).hexdigest()[:16]
        conn.execute(
            """INSERT INTO polls(id, org, label, population, race, scenario, field_start, field_end, published_at,
               sample_size, moe, numbers_hidden, note, news_url, support_json, raw_percents_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                poll_id, row.get("org"), row.get("label"), row.get("population"), row.get("race"), row.get("scenario"),
                row.get("field_start"), row.get("field_end"), row.get("published_at"), row.get("sample_size"),
                row.get("moe"), _flag(row.get("numbers_hidden")) if "numbers_hidden" in row else None,
                row.get("note"), row.get("news_url"),
                json.dumps(row.get("support"), ensure_ascii=False) if row.get("support") is not None else None,
                json.dumps(row.get("raw_percents"), ensure_ascii=False) if row.get("raw_percents") is not None else None,
            ),
        )
        for report in row.get("reports") or []:
            if isinstance(report, dict):
                conn.execute(
                    "INSERT INTO poll_reports(poll_id, url, title, source_name, published_at) VALUES (?, ?, ?, ?, ?)",
                    (poll_id, report.get("url"), report.get("title"), report.get("source_name"), report.get("published_at")),
                )
    _remember(conn, path, root, len(rows), "polls")


def _budget_value(budget, key):
    if not isinstance(budget, dict) or key not in budget:
        return None
    return budget.get(key)


def _load_projects(conn, root: Path, data: Path) -> None:
    path = data / "governance.json"
    payload = _read(path) or {}
    for project in payload.get("projects") or []:
        budget = project.get("budget")
        progress = project.get("progress") if isinstance(project.get("progress"), dict) else None
        target = project.get("target") if isinstance(project.get("target"), dict) else None
        conn.execute(
            """INSERT INTO projects(id, title, region_id, topic_id, agency, phase, phase_as_of, summary,
               target_value, target_precision, approved_twd, contract_twd, spent_twd, progress_value, progress_as_of,
               geometry, location_precision)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                project.get("id"), project.get("title"), project.get("region_id"), project.get("topic_id"),
                project.get("agency"), project.get("phase"), project.get("phase_as_of"), project.get("summary"),
                None if target is None else target.get("value"),
                None if target is None else target.get("precision"),
                _budget_value(budget, "approved_twd"), _budget_value(budget, "contract_twd"), _budget_value(budget, "spent_twd"),
                None if progress is None else progress.get("value"),
                None if progress is None else progress.get("as_of"),
                None, "unknown",
            ),
        )
        for event in project.get("events") or []:
            conn.execute(
                "INSERT INTO project_events(project_id, event_date, precision, summary, source_id, kind) VALUES (?, ?, ?, ?, ?, ?)",
                (project.get("id"), event.get("date"), event.get("precision"), event.get("summary"), event.get("source_id"), event.get("kind")),
            )
        for evidence in project.get("missing_evidence") or []:
            conn.execute("INSERT INTO project_missing(project_id, evidence) VALUES (?, ?)", (project.get("id"), evidence))
    registry = _read(data / "governance-registry.json") or {}
    for source in registry.get("sources") or []:
        conn.execute(
            """INSERT OR REPLACE INTO sources(id, name, kind, url, region_ids, access_method, origin, health, coverage_note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                source.get("id"), source.get("name"), source.get("kind"), source.get("url"),
                json.dumps([source.get("region_id")], ensure_ascii=False), "legacy-registry", "legacy",
                "indexed", "既有治理索引。source_updated_at 與 checked_at 仍在原檔，本表不把 HTTP 狀態升成已查核。",
            ),
        )
    _remember(conn, path, root, len(payload.get("projects") or []), "governance-projects")


def _load_stances(conn, root: Path, data: Path) -> None:
    path = data / "issue_stances.json"
    payload = _read(path) or {}
    for issue in payload.get("issues") or []:
        for stance in (issue.get("stances") or {}).values():
            if not isinstance(stance, dict):
                continue
            conn.execute(
                """INSERT OR REPLACE INTO issue_stances(issue_id, person_id, has_statement, published_at, quote, summary,
                   source_name, source_url, role_at_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    issue.get("id"), stance.get("person_id"),
                    "present" if stance.get("found") is True else "absent" if stance.get("found") is False else None,
                    stance.get("published_at"), stance.get("quote"), stance.get("summary"),
                    stance.get("source_name"), stance.get("source_url"), stance.get("role_at_time"),
                ),
            )
    _remember(conn, path, root, len(payload.get("issues") or []), "issue-stances")


def _load_pending_news(conn, root: Path, data: Path) -> None:
    path = data / "news-monitor" / "manual.json"
    payload = _read(path) or {}
    for article in payload.get("articles") or []:
        if not isinstance(article, dict) or not article.get("id"):
            continue
        conn.execute(
            """INSERT INTO pending_news(id, title, url, publisher, reported_publication_time, date_precision,
               verification_status, review_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                article.get("id"), article.get("title"), article.get("url"), article.get("publisher"),
                article.get("reported_publication_time"), article.get("date_precision"),
                article.get("verification_status"), article.get("review_status"),
            ),
        )
    _remember(conn, path, root, len(payload.get("articles") or []), "pending-news")


def _load_official(conn, root: Path, data: Path) -> None:
    path = data / "official.json"
    payload = _read(path) or {}
    rows = []
    for person in (payload.get("by_person") or {}).values():
        if isinstance(person, dict):
            for item in person.get("items") or []:
                if isinstance(item, dict) and item.get("id"):
                    rows.append(_article_tuple(item, "official", "public/data/official.json"))
    if rows:
        conn.executemany(
            """INSERT OR IGNORE INTO articles(id, origin, legacy_file, person_id, title, url, source_name, platform,
               published_at, collected_at, summary, review_status, counts_in_stats, tone_label)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
    _remember(conn, path, root, len(rows), "official-statements")


def _load_comparisons(conn, data: Path) -> None:
    payload = _read(data / "civic" / "comparisons.json") or {}
    conn.executemany(
        """INSERT INTO questions(id, question, window_start, window_end, agency_record_ids, project_ids,
           support_record_ids, criticism_record_ids, response_record_ids, counterevidence_record_ids,
           unknown_json, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [(
            row.get("id"), row.get("question"), (row.get("window") or {}).get("start"), (row.get("window") or {}).get("end"),
            json.dumps(row.get("agency_record_ids"), ensure_ascii=False),
            json.dumps(row.get("project_ids"), ensure_ascii=False),
            json.dumps(row.get("support_record_ids"), ensure_ascii=False) if row.get("support_record_ids") is not None else None,
            json.dumps(row.get("criticism_record_ids"), ensure_ascii=False) if row.get("criticism_record_ids") is not None else None,
            json.dumps(row.get("response_record_ids"), ensure_ascii=False) if row.get("response_record_ids") is not None else None,
            json.dumps(row.get("counterevidence_record_ids"), ensure_ascii=False) if row.get("counterevidence_record_ids") is not None else None,
            json.dumps(row.get("unknown"), ensure_ascii=False) if row.get("unknown") is not None else None,
            row.get("note"),
        ) for row in payload.get("questions") or [] if row.get("id")],
    )


def _load_civic(conn, data: Path) -> None:
    sources = _read(data / "civic" / "sources.json") or {}
    for source in sources.get("sources") or []:
        conn.execute(
            """INSERT OR REPLACE INTO sources(
               id, name, kind, url, region_ids, access_method, permission, coverage_note, interval_minutes,
               date_field, gap, last_attempt_at, last_success_at, next_due_at, health, error, last_http_status,
               consecutive_failures, records_kept, origin)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                source.get("id"), source.get("name"), source.get("kind"), source.get("url"),
                json.dumps(source.get("region_ids"), ensure_ascii=False), source.get("access_method"),
                source.get("permission"), source.get("coverage_note"), source.get("interval_minutes"),
                source.get("date_field"), source.get("gap"), source.get("last_attempt_at"), source.get("last_success_at"),
                source.get("next_due_at"), source.get("health"), source.get("error"), source.get("last_http_status"),
                source.get("consecutive_failures"), source.get("records_kept"), "civic",
            ),
        )
    records = _read(data / "civic" / "records.json") or {}
    conn.executemany(
        """INSERT INTO civic_records(id, kind, source_id, source_url, title, published_at, collected_at, checked_at,
           date_precision, text_excerpt, claim_origin, verification_status, stats_eligible, region_refs, actor_refs)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [(
            row.get("id"), row.get("kind"), row.get("source_id"), row.get("source_url"), row.get("title"),
            row.get("published_at"), row.get("collected_at"), row.get("checked_at"), row.get("date_precision"),
            row.get("text_excerpt"), row.get("claim_origin"), row.get("verification_status"),
            _flag(row.get("stats_eligible")) if "stats_eligible" in row else None,
            json.dumps(row.get("region_refs"), ensure_ascii=False), json.dumps(row.get("actor_refs"), ensure_ascii=False),
        ) for row in records.get("records") or []],
    )
    corrections = _read(data / "civic" / "corrections.json") or {}
    conn.executemany(
        "INSERT INTO corrections(id, record_id, source_id, changed_at, fields_json, note) VALUES (?, ?, ?, ?, ?, ?)",
        [(
            row.get("id"), row.get("record_id"), row.get("source_id"), row.get("changed_at"),
            json.dumps(row.get("fields"), ensure_ascii=False), row.get("note"),
        ) for row in corrections.get("corrections") or [] if row.get("id")],
    )
    feed = _read(data / "civic" / "feed.json") or {}
    if feed:
        conn.execute(
            """INSERT INTO feed(id, etag, content_hash, generated_at, last_attempt_at, last_success_at, status, stale_after_minutes)
               VALUES (1, ?, ?, ?, ?, ?, ?, ?)""",
            (
                feed.get("etag"), feed.get("content_hash"), feed.get("generated_at"), feed.get("last_attempt_at"),
                feed.get("last_success_at"), feed.get("status"), feed.get("stale_after_minutes"),
            ),
        )
