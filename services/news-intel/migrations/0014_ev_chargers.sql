CREATE TABLE IF NOT EXISTS ev_chargers (
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  postal_code TEXT,
  address TEXT,
  note TEXT,
  township TEXT,
  region_id TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, name)
);
