CREATE TABLE IF NOT EXISTS river_samples (
  river TEXT NOT NULL,
  station TEXT NOT NULL,
  sample_date TEXT NOT NULL,
  measures_json TEXT NOT NULL,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (river, station, sample_date)
);
