CREATE TABLE IF NOT EXISTS county_bridges (
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  township TEXT,
  region_id TEXT,
  road_class TEXT,
  length_m TEXT,
  longitude TEXT,
  latitude TEXT,
  structure TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, name)
);
