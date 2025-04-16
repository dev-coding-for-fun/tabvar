-- Migration number: 0042 	 2025-04-16T02:07:54.968Z

-- Add crag_id column to route table
ALTER TABLE "route" ADD COLUMN "crag_id" INTEGER REFERENCES "crag"("id");

-- Populate crag_id based on sector's crag_id
UPDATE "route"
SET "crag_id" = (
    SELECT "crag_id"
    FROM "sector"
    WHERE "sector"."id" = "route"."sector_id"
);

-- Create an index for the foreign key
DROP INDEX IF EXISTS "route_crag_id_index";
CREATE INDEX "route_crag_id_index" ON "route"("crag_id");

-- Create a trigger to keep crag_id in sync when sector_id changes
DROP TRIGGER IF EXISTS update_route_crag_id;
CREATE TRIGGER update_route_after_sector_switch AFTER UPDATE OF sector_id ON "route"
FOR EACH ROW
BEGIN
    UPDATE "route"
    SET "crag_id" = (SELECT "crag_id" FROM "sector" WHERE "sector"."id" = NEW.sector_id),
        "sector_name" = (SELECT name FROM sector WHERE id = NEW.sector_id),
        "crag_name" = (SELECT name FROM crag WHERE id = (SELECT crag_id FROM sector WHERE id = NEW.sector_id))
    WHERE "id" = NEW.id;
END;


DROP TRIGGER IF EXISTS update_route_sector_name;
CREATE TRIGGER update_route_after_sector_changed AFTER UPDATE OF name, crag_id ON sector
FOR EACH ROW
BEGIN
    UPDATE route SET sector_name = NEW.name,
        crag_id = NEW.crag_id,
        crag_name = (SELECT name FROM crag WHERE id = NEW.crag_id)
    WHERE sector_id = NEW.id;
END;

DROP TRIGGER IF EXISTS update_route_crag_when_sector_moved;

DROP TRIGGER IF EXISTS update_route_with_crag;
CREATE TRIGGER update_route_with_crag_change AFTER UPDATE OF name ON crag
FOR EACH ROW
BEGIN
    UPDATE route SET crag_name = NEW.name WHERE crag_id = NEW.id;
END;

CREATE TRIGGER route_fill_after_insert
AFTER INSERT ON route
FOR EACH ROW
BEGIN
  UPDATE route
  SET
    sector_name = (SELECT name FROM sector WHERE id = NEW.sector_id),
    crag_id = (SELECT crag_id FROM sector WHERE id = NEW.sector_id),
    crag_name = (
      SELECT name FROM crag
      WHERE id = (SELECT crag_id FROM sector WHERE id = NEW.sector_id)
    )
  WHERE id = NEW.id;
END;

DROP TABLE IF EXISTS "route_search";
CREATE VIRTUAL TABLE route_search USING fts5(
  "name",
  alt_names,
  sector_name,
  crag_name,
  sector_id UNINDEXED,
  crag_id UNINDEXED,
  grade_yds UNINDEXED,
  bolt_count UNINDEXED,
  pitch_count UNINDEXED,
  content='route',
  content_rowid='id',
  tokenize="unicode61 tokenchars '-_()[]{}?!%&,.:+'");

DROP TRIGGER IF EXISTS route_search_insert;
CREATE TRIGGER route_search_insert AFTER INSERT ON "route" BEGIN
    INSERT INTO route_search(rowid, name, alt_names, sector_name, crag_name, sector_id, crag_id, grade_yds, bolt_count, pitch_count) 
    VALUES (new.id, new.name, new.alt_names, new.sector_name, new.crag_name, new.sector_id, new.crag_id, new.grade_yds, new.bolt_count, new.pitch_count);
END;

DROP TRIGGER IF EXISTS route_search_del;
CREATE TRIGGER route_search_del AFTER DELETE ON "route" BEGIN
    INSERT INTO route_search(route_search, rowid, name, alt_names, sector_name, crag_name, sector_id, crag_id, grade_yds, bolt_count, pitch_count) 
    VALUES('delete', old.id, old.name, old.alt_names, old.sector_name, old.crag_name, old.sector_id, old.crag_id, old.grade_yds, old.bolt_count, old.pitch_count);
END;

DROP TRIGGER IF EXISTS route_search_update;
CREATE TRIGGER route_search_update AFTER UPDATE ON "route" BEGIN
    INSERT INTO route_search(route_search, rowid, name, alt_names, sector_name, crag_name, sector_id, crag_id, grade_yds, bolt_count, pitch_count)
    VALUES('delete', old.id, old.name, old.alt_names, old.sector_name, old.crag_name, old.sector_id, old.crag_id, old.grade_yds, old.bolt_count, old.pitch_count);
    INSERT INTO route_search(rowid, name, alt_names, sector_name, crag_name, sector_id, crag_id, grade_yds, bolt_count, pitch_count)
    VALUES(new.id, new.name, new.alt_names, new.sector_name, new.crag_name, new.sector_id, new.crag_id, new.grade_yds, new.bolt_count, new.pitch_count);
END;

-- Rebuild the search index
INSERT INTO route_search (rowid, name, alt_names, sector_name, crag_name, sector_id, crag_id, grade_yds, bolt_count, pitch_count) 
SELECT 
    r.id, 
    r.name, 
    r.alt_names, 
    r.sector_name, 
    r.crag_name, 
    r.sector_id, 
    r.crag_id, 
    r.grade_yds, 
    r.bolt_count, 
    r.pitch_count
FROM route r;

-- Optimize the index
INSERT INTO route_search(route_search) VALUES('optimize');
