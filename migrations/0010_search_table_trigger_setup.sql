-- Migration number: 0010 	 2024-05-10T05:47:03.634Z
DROP TABLE IF EXISTS "route_search";

CREATE VIRTUAL TABLE "route_search" USING fts5(
    "name",
    sector_name,
    crag_name,
    content='route',
    content_rowid='id');


DROP TRIGGER IF EXISTS route_search_insert;
CREATE TRIGGER route_search_insert AFTER INSERT ON "route" BEGIN
    INSERT INTO route_search(rowid, name, sector_name, crag_name) 
    VALUES (new.id, new.name, new.sector_name, new.crag_name);
END;

DROP TRIGGER IF EXISTS route_search_del;
CREATE TRIGGER route_search_del AFTER DELETE ON "route" BEGIN
    INSERT INTO route_search(route_search, rowid, name, sector_name, crag_name) 
    VALUES('delete', old.id, old.name, old.sector_name, old.crag_name);
END;

DROP TRIGGER IF EXISTS route_search_update;
CREATE TRIGGER route_search_update AFTER UPDATE ON "route" BEGIN
    INSERT INTO route_search(route_search, rowid, name, sector_name, crag_name)
    VALUES('delete', old.id, old.name, old.sector_name, old.crag_name);
    INSERT INTO route_search(rowid, name, sector_name, crag_name)
    VALUES(new.id, new.name, new.sector_name, new.crag_name);
END;

INSERT INTO route_search (rowid, name, sector_name, crag_name) SELECT id, name, sector_name, crag_name FROM route