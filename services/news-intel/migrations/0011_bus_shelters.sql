CREATE TABLE IF NOT EXISTS bus_shelters (
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  year TEXT NOT NULL DEFAULT '',
  kind TEXT,
  road TEXT,
  direction TEXT,
  routes TEXT,
  agency TEXT,
  opened TEXT,
  integrated TEXT,
  township TEXT,
  region_id TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, name, year)
);
