CREATE TABLE IF NOT EXISTS kindergarten_roster (
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  period_text TEXT NOT NULL DEFAULT '',
  category TEXT,
  postal_code TEXT,
  township TEXT,
  region_id TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (name, address, period_text)
);

CREATE TABLE IF NOT EXISTS speed_cameras (
  place TEXT NOT NULL,
  district TEXT NOT NULL,
  period_text TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  region_id TEXT,
  kind TEXT,
  offense TEXT,
  latitude TEXT,
  longitude TEXT,
  direction TEXT,
  speed_limit TEXT,
  station TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (place, district, period_text, code)
);

CREATE TABLE IF NOT EXISTS special_classes (
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  period_text TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  class_type TEXT,
  township TEXT,
  region_id TEXT,
  period TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (name, address, period_text, code)
);

CREATE TABLE IF NOT EXISTS use_permit_summaries (
  dataset_url TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  permit_count INTEGER NOT NULL,
  dated INTEGER NOT NULL,
  outside_count INTEGER NOT NULL,
  unreadable INTEGER NOT NULL,
  earliest_issue_date TEXT,
  latest_issue_date TEXT,
  fetched_at TEXT NOT NULL
);
