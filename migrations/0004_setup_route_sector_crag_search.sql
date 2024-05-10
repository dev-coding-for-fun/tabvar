-- Migration number: 0004 	 2024-05-08T21:31:26.795Z
CREATE VIRTUAL TABLE all_search USING fts5(route_name, route_alt_names, sector_name, crag_name);
INSERT INTO all_search(route_name, route_alt_names, sector_name, crag_name) 
SELECT "route"."name", "route"."alt_names", "sector"."name", "crag"."name" FROM "route" 
LEFT JOIN "sector" ON "route"."sector_id" = "sector"."id"
INNER JOIN "crag" ON "sector"."crag_id" = "crag"."id";