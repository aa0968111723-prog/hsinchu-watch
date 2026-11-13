CREATE TABLE IF NOT EXISTS gas_stations (
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  operator TEXT,
  opened_on TEXT,
  address TEXT,
  supplier TEXT,
  note TEXT,
  township TEXT,
  region_id TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, name)
);
