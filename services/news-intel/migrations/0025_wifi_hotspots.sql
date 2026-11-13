CREATE TABLE IF NOT EXISTS wifi_hotspots (
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  postal_code TEXT,
  address TEXT,
  area TEXT,
  region_id TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, name)
);
