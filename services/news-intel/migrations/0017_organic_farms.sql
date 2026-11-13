CREATE TABLE IF NOT EXISTS organic_farms (
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  postal_code TEXT,
  address TEXT,
  township TEXT,
  region_id TEXT,
  certifier TEXT,
  transition_cert TEXT,
  organic_cert TEXT,
  valid_until TEXT,
  status TEXT,
  area TEXT,
  products TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, name)
);
