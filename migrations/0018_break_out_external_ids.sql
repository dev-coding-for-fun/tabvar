-- Migration number: 0018 	 2024-06-15T21:38:34.397Z
DROP TABLE IF EXISTS "issue_attachment";
CREATE TABLE "issue_attachment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "issue_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("issue_id") REFERENCES issue("id") ON DELETE CASCADE
);

DROP TABLE IF EXISTS "issue";
CREATE TABLE "issue" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "route_id" INTEGER NOT NULL,
    "issue_type" TEXT NOT NULL,
    "sub_issue_type" TEXT,
    "bolts_affected" TEXT,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "reported_by_uid" TEXT,
    "approved_by_uid" TEXT,
    "archived_by_uid" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP,
    "archived_at" TIMESTAMP,
    FOREIGN KEY("route_id") REFERENCES "route"("id"),
    FOREIGN KEY("reported_by_uid") REFERENCES "user"("uid"),
    FOREIGN KEY("approved_by_uid") REFERENCES "user"("uid"),
    FOREIGN KEY("archived_by_uid") REFERENCES "user"("uid")
);


DROP TABLE IF EXISTS "route";
CREATE TABLE "route" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "alt_names" TEXT,
    "sector_id" INTEGER,
    "sector_name" TEXT,
    "crag_name" TEXT,
    "grade_yds" TEXT,
    "climb_style" TEXT,
    "sort_order" INTEGER,
    "status" TEXT,
    "bolt_count" INTEGER,
    "pitch_count" INTEGER,
    "first_ascent_by" TEXT,
    "first_ascent_date" TIMESTAMP,
    "route_built_date" TIMESTAMP,
    "route_length" REAL,
    "latitude" REAL,
    "longitude" REAL,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("sector_id") REFERENCES sector("id"),
    UNIQUE("name", "sector_id")
);

DROP TABLE IF EXISTS "sector";
CREATE TABLE "sector" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "crag_id" INTEGER,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "latitude" REAL,
    "longitude" REAL,
    FOREIGN KEY("crag_id") REFERENCES crag("id"),
    UNIQUE("name", "crag_id")
);

DROP TABLE IF EXISTS "crag";
CREATE TABLE "crag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL UNIQUE,
    "has_sectors" BOOLEAN NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "latitude" REAL,
    "longitude" REAL
);

CREATE TABLE "external_crag_ref" (
    "local_id" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    FOREIGN KEY("local_id") REFERENCES crag("id"),
    UNIQUE("external_id", "source") ON CONFLICT REPLACE
);

CREATE TABLE "external_sector_ref" (
    "local_id" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    FOREIGN KEY("local_id") REFERENCES sector("id"),
    UNIQUE("external_id", "source") ON CONFLICT REPLACE
);

CREATE TABLE "external_route_ref" (
    "local_id" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    FOREIGN KEY("local_id") REFERENCES "route"("id"),
    UNIQUE("external_id", "source") ON CONFLICT REPLACE
);

CREATE TABLE "external_issue_ref" (
    "local_id" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    FOREIGN KEY("local_id") REFERENCES issue("id"),
    UNIQUE("external_id", "source") ON CONFLICT REPLACE
);

DROP INDEX IF EXISTS "sector_crag_id_index";
DROP INDEX IF EXISTS "route_sector_id_index";
DROP INDEX IF EXISTS "route_crag_id_index";
DROP INDEX IF EXISTS "signin_event_uid_index";
DROP INDEX IF EXISTS "route_issue_index";
DROP INDEX IF EXISTS "issue_created_at";
DROP INDEX IF EXISTS "attachment_issue_id_index";
CREATE INDEX "sector_crag_id_index" ON "sector"("crag_id");
CREATE INDEX "route_sector_id_index" ON "route"("sector_id");
CREATE INDEX "route_crag_id_index" ON "route"("crag_id");
CREATE INDEX "signin_event_uid_index" ON "signin_event"("uid");
CREATE INDEX "route_issue_index" ON "issue"("route_id");
CREATE INDEX "issue_created_at" ON "issue"("created_at");
CREATE INDEX "attachment_issue_id_index" ON "issue_attachment"("issue_id");

DROP TRIGGER IF EXISTS update_route_sector_name;
CREATE TRIGGER update_route_sector_name AFTER UPDATE ON sector
FOR EACH ROW
BEGIN
    UPDATE route SET sector_name = NEW.name WHERE sector_id = NEW.id;
END;

DROP TRIGGER IF EXISTS update_route_crag_when_sector_moved;

CREATE TRIGGER update_route_crag_when_sector_moved AFTER UPDATE OF crag_id ON sector
FOR EACH ROW
BEGIN
    UPDATE route
    SET crag_name = (SELECT name FROM crag WHERE id = NEW.crag_id)
    WHERE sector_id = NEW.id;
END;

DROP TRIGGER IF EXISTS update_route_with_crag;
CREATE TRIGGER update_route_with_crag AFTER UPDATE ON crag
FOR EACH ROW
BEGIN
    UPDATE route SET crag_name = NEW.name WHERE sector_id IN (SELECT id FROM sector WHERE crag_id = NEW.id);
END;

DROP TRIGGER IF EXISTS delete_sector;
CREATE TRIGGER delete_sector BEFORE DELETE ON sector
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, "Can't delete sector because routes still exist in the sector.  Delete routes first")
        WHERE EXISTS (SELECT 1 FROM route WHERE sector_id = OLD.id);
END;

DROP TRIGGER IF EXISTS delete_crag;
CREATE TRIGGER delete_crag BEFORE DELETE ON crag
FOR EACH ROW
BEGIN
    SELECT RAISE(FAIL, "Can't delete crag because sectors still exist in the sector.  Delete sectors (and routes within) first")
        WHERE EXISTS (SELECT 1 FROM sector WHERE crag_id = OLD.id);
END;

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
