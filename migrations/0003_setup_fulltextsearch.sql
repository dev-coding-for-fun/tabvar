-- Migration number: 0003 	 2024-05-07T22:21:40.259Z
ALTER TABLE "route" ADD alt_names TEXT;

CREATE VIRTUAL TABLE route_search USING fts5(route_name, route_alt_names);
INSERT INTO route_search(route_name, route_alt_names) SELECT "name", "alt_names" FROM "route";
