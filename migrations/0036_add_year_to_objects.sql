-- Migration number: 0036 	 2025-04-03T01:53:01.592Z

ALTER TABLE route ADD COLUMN year INTEGER;

CREATE INDEX idx_route_year_created_at ON route(year, created_at);
