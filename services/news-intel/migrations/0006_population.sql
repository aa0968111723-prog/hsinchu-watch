CREATE TABLE IF NOT EXISTS population_counts (
  area_code TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT '',
  area_label TEXT NOT NULL,
  total_text TEXT,
  period_text TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (area_code, period)
);
