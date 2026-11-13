CREATE TABLE IF NOT EXISTS discharge_daily (
  date TEXT PRIMARY KEY,
  year TEXT,
  daily_flow TEXT,
  cumulative TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
