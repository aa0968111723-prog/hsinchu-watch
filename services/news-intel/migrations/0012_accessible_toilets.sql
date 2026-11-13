CREATE TABLE IF NOT EXISTS accessible_toilets (
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  township TEXT NOT NULL DEFAULT '',
  region_id TEXT,
  village TEXT,
  address TEXT,
  kind TEXT,
  note TEXT,
  period_text TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, name, township)
);
