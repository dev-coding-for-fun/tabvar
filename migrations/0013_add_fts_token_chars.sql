-- Migration number: 0013 	 2024-05-24T01:35:57.958Z
DROP TABLE IF EXISTS "route_search";

CREATE VIRTUAL TABLE "route_search" USING fts5(
    "name",
    sector_name,
    crag_name,
    grade_yds UNINDEXED,
    bolt_count UNINDEXED,
    pitch_count UNINDEXED,
    content='route',
    content_rowid='id',
    tokenize = "unicode61 tokenchars '-_()[]{}?!%&,.:+'");


DROP TRIGGER IF EXISTS route_search_insert;
CREATE TRIGGER route_search_insert AFTER INSERT ON "route" BEGIN
    INSERT INTO route_search(rowid, name, sector_name, crag_name, grade_yds, bolt_count, pitch_count) 
    VALUES (new.id, new.name, new.sector_name, new.crag_name, new.grade_yds, new.bolt_count, new.pitch_count);
END;

DROP TRIGGER IF EXISTS route_search_del;
CREATE TRIGGER route_search_del AFTER DELETE ON "route" BEGIN
    INSERT INTO route_search(route_search, rowid, name, sector_name, crag_name, grade_yds, bolt_count, pitch_count) 
    VALUES('delete', old.id, old.name, old.sector_name, old.crag_name, old.grade_yds, old.bolt_count, old.pitch_count);
END;

DROP TRIGGER IF EXISTS route_search_update;
CREATE TRIGGER route_search_update AFTER UPDATE ON "route" BEGIN
    INSERT INTO route_search(route_search, rowid, name, sector_name, crag_name, grade_yds, bolt_count, pitch_count)
    VALUES('delete', old.id, old.name, old.sector_name, old.crag_name, old.grade_yds, old.bolt_count, old.pitch_count);
    INSERT INTO route_search(rowid, name, sector_name, crag_name, grade_yds, bolt_count, pitch_count)
    VALUES(new.id, new.name, new.sector_name, new.crag_name, new.grade_yds, new.bolt_count, new.pitch_count);
END;

INSERT INTO route_search (rowid, name, sector_name, crag_name, grade_yds, bolt_count, pitch_count) SELECT id, name, sector_name, crag_name, grade_yds, bolt_count, pitch_count FROM route;

INSERT INTO route_search(route_search) VALUES('optimize');