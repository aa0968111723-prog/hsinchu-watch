CREATE TABLE IF NOT EXISTS fire_hydrants (
  code TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL,
  water_code TEXT,
  kind TEXT,
  pressure TEXT,
  township TEXT,
  region_id TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, place)
);
