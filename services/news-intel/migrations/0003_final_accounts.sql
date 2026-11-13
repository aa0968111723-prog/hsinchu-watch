CREATE TABLE IF NOT EXISTS final_accounts (
  id TEXT PRIMARY KEY,
  region_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  spent_text TEXT,
  unit TEXT,
  dataset_url TEXT NOT NULL,
  list_url TEXT NOT NULL,
  note TEXT NOT NULL,
  UNIQUE(region_id, year)
);
