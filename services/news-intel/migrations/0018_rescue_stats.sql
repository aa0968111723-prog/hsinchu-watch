CREATE TABLE IF NOT EXISTS rescue_stats (
  region TEXT PRIMARY KEY,
  region_id TEXT,
  general_ambulances TEXT,
  intensive_ambulances TEXT,
  transports TEXT,
  not_transported TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
