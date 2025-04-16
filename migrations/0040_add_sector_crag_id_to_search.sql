-- Migration number: 0040 	 2025-04-15T03:46:01.198Z

-- Drop the existing FTS table and triggers
DROP TRIGGER IF EXISTS route_search_update;
DROP TRIGGER IF EXISTS route_search_del;
DROP TRIGGER IF EXISTS route_search_insert;
DROP TABLE IF EXISTS "route_search";

-- Recreate the FTS table with new columns
CREATE VIRTUAL TABLE "route_search" USING fts5(
    route_name,
    route_alt_names,
    sector_name,
    crag_name,
    sector_id UNINDEXED,
    crag_id UNINDEXED,
    grade_yds UNINDEXED,
    bolt_count UNINDEXED,
    pitch_count UNINDEXED,
    content='route',
    content_rowid='id',
    tokenize = "unicode61 tokenchars '-_()[]{}?!%&,.:+'");

-- Recreate the triggers
CREATE TRIGGER route_search_insert AFTER INSERT ON "route" BEGIN
    INSERT INTO route_search(rowid, route_name, route_alt_names, sector_name, crag_name, sector_id, crag_id, grade_yds, bolt_count, pitch_count) 
    SELECT 
        new.id, 
        new.name, 
        new.alt_names, 
        new.sector_name, 
        new.crag_name, 
        new.sector_id, 
        s.id,
        new.grade_yds, 
        new.bolt_count, 
        new.pitch_count
    FROM route r
    LEFT JOIN sector s ON r.sector_id = s.id
    WHERE r.id = new.id;
END;

CREATE TRIGGER route_search_del AFTER DELETE ON "route" BEGIN
    INSERT INTO route_search(route_search, rowid, route_name, route_alt_names, sector_name, crag_name, sector_id, crag_id, grade_yds, bolt_count, pitch_count) 
    SELECT 
        'delete',
        old.id, 
        old.name, 
        old.alt_names, 
        old.sector_name, 
        old.crag_name, 
        old.sector_id, 
        s.id,
        old.grade_yds, 
        old.bolt_count, 
        old.pitch_count
    FROM route r
    LEFT JOIN sector s ON r.sector_id = s.id
    WHERE r.id = old.id;
END;

CREATE TRIGGER route_search_update AFTER UPDATE ON "route" BEGIN
    -- Delete old record
    INSERT INTO route_search(route_search, rowid, route_name, route_alt_names, sector_name, crag_name, sector_id, crag_id, grade_yds, bolt_count, pitch_count) 
    SELECT 
        'delete',
        old.id, 
        old.name, 
        old.alt_names, 
        old.sector_name, 
        old.crag_name, 
        old.sector_id, 
        s.id,
        old.grade_yds, 
        old.bolt_count, 
        old.pitch_count
    FROM route r
    LEFT JOIN sector s ON r.sector_id = s.id
    WHERE r.id = old.id;
    
    -- Insert new record
    INSERT INTO route_search(rowid, route_name, route_alt_names, sector_name, crag_name, sector_id, crag_id, grade_yds, bolt_count, pitch_count)
    SELECT 
        new.id, 
        new.name, 
        new.alt_names, 
        new.sector_name, 
        new.crag_name, 
        new.sector_id, 
        s.id,
        new.grade_yds, 
        new.bolt_count, 
        new.pitch_count
    FROM route r
    LEFT JOIN sector s ON r.sector_id = s.id
    WHERE r.id = new.id;
END;

-- Rebuild the search index
INSERT INTO route_search (rowid, route_name, route_alt_names, sector_name, crag_name, sector_id, crag_id, grade_yds, bolt_count, pitch_count) 
SELECT 
    r.id, 
    r.name, 
    r.alt_names, 
    r.sector_name, 
    r.crag_name, 
    r.sector_id, 
    s.id,
    r.grade_yds, 
    r.bolt_count, 
    r.pitch_count
FROM route r
LEFT JOIN sector s ON r.sector_id = s.id;

-- Optimize the index
INSERT INTO route_search(route_search) VALUES('optimize');
