-- Non-destructive initial schema. Existing static JSON is not stored here.
-- Rollback: drop these tables only after exporting audit_logs and articles.

CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  official_url TEXT,
  docs_url TEXT,
  license TEXT,
  is_free INTEGER,
  needs_key INTEGER,
  free_quota TEXT,
  update_frequency TEXT,
  status TEXT NOT NULL,
  last_success_at TEXT
);

CREATE TABLE IF NOT EXISTS source_endpoints (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET'
);

CREATE TABLE IF NOT EXISTS source_licenses (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  original_title TEXT NOT NULL,
  source_name TEXT,
  source_type TEXT,
  publisher_timestamp TEXT,
  timestamp_precision TEXT,
  fetched_at TEXT NOT NULL,
  verified_at TEXT,
  topic TEXT,
  region_id TEXT,
  event_id TEXT,
  source_license TEXT,
  verification_status TEXT NOT NULL,
  review_status TEXT NOT NULL,
  claim_kind TEXT,
  content_hash TEXT NOT NULL,
  content_version INTEGER NOT NULL DEFAULT 1,
  attribution TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_url),
  UNIQUE(content_hash)
);

CREATE TABLE IF NOT EXISTS article_versions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  content_version INTEGER NOT NULL,
  original_title TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_sources (
  article_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (article_id, source_id)
);

CREATE TABLE IF NOT EXISTS article_evidence (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  region_id TEXT,
  occurred_on TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_article_links (
  event_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  PRIMARY KEY (event_id, article_id)
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS government_agencies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region_id TEXT
);

CREATE TABLE IF NOT EXISTS government_announcements (
  id TEXT PRIMARY KEY,
  agency_id TEXT,
  title TEXT NOT NULL,
  source_url TEXT,
  published_on TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS government_projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  region_id TEXT,
  agency_id TEXT
);

CREATE TABLE IF NOT EXISTS project_progress (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  reported_value REAL,
  as_of TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS project_budgets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  approved_twd INTEGER,
  awarded_twd INTEGER,
  spent_twd INTEGER,
  approved_as_of TEXT,
  awarded_as_of TEXT,
  spent_as_of TEXT
);

CREATE TABLE IF NOT EXISTS project_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  happened_on TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS elections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region_id TEXT
);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  election_id TEXT
);

CREATE TABLE IF NOT EXISTS candidate_statements (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source_url TEXT,
  claim_kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  org TEXT,
  sponsor TEXT,
  source_url TEXT
);

CREATE TABLE IF NOT EXISTS poll_methodologies (
  poll_id TEXT PRIMARY KEY,
  field_start TEXT,
  field_end TEXT,
  sample_size INTEGER,
  method TEXT,
  margin_of_error REAL
);

CREATE TABLE IF NOT EXISTS poll_results (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL,
  label TEXT,
  value REAL
);

CREATE TABLE IF NOT EXISTS transport_updates (
  id TEXT PRIMARY KEY,
  region_id TEXT,
  summary TEXT NOT NULL,
  source_url TEXT,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS environment_observations (
  id TEXT PRIMARY KEY,
  region_id TEXT,
  summary TEXT NOT NULL,
  source_url TEXT,
  observed_at TEXT
);

CREATE TABLE IF NOT EXISTS education_announcements (
  id TEXT PRIMARY KEY,
  region_id TEXT,
  title TEXT NOT NULL,
  source_url TEXT,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS review_queue (
  id TEXT PRIMARY KEY,
  article_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  article_count INTEGER NOT NULL DEFAULT 0,
  gemini_used INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS agent_run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_errors (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  units INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_region ON articles(region_id, publisher_timestamp);
CREATE INDEX IF NOT EXISTS idx_review_status ON review_queue(status);
