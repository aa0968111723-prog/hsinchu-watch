CREATE TABLE IF NOT EXISTS published_snapshots (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  articles_json TEXT NOT NULL,
  last_success_at TEXT NOT NULL
);
