CREATE TABLE IF NOT EXISTS electric_bus_routes (
  code TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL,
  route_number TEXT NOT NULL DEFAULT '',
  county TEXT,
  vehicles TEXT,
  brand TEXT,
  model TEXT,
  dataset_url TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (code, route, route_number)
);
