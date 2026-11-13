CREATE TABLE IF NOT EXISTS junior_high_zones (
  school_name TEXT NOT NULL,
  township TEXT NOT NULL,
  township_code TEXT,
  zone_text TEXT,
  period TEXT NOT NULL DEFAULT '',
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (school_name, township, period)
);
