CREATE TABLE IF NOT EXISTS heritage_sites (
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  township TEXT NOT NULL DEFAULT '',
  region_id TEXT,
  heritage_kind TEXT,
  designation TEXT,
  postal_code TEXT,
  address TEXT,
  ownership TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, name, township)
);
