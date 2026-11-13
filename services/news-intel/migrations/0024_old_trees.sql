CREATE TABLE IF NOT EXISTS old_trees (
  code TEXT NOT NULL,
  species TEXT NOT NULL,
  place TEXT NOT NULL,
  township TEXT,
  region_id TEXT,
  age_years TEXT,
  height_m TEXT,
  girth_m TEXT,
  diameter_m TEXT,
  crown_m2 TEXT,
  ownership TEXT,
  coord_x TEXT,
  coord_y TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, place)
);
