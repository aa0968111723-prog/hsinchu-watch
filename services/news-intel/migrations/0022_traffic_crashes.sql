CREATE TABLE IF NOT EXISTS traffic_crash_counts (
  period_text TEXT PRIMARY KEY,
  period TEXT,
  a1 TEXT,
  a2 TEXT,
  a3 TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
