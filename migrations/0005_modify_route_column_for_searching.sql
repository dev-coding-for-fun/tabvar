-- Migration number: 0005 	 2024-05-08T21:38:52.108Z
ALTER TABLE "route" ADD COLUMN sector_name TEXT;
ALTER TABLE "route" ADD COLUMN crag_name TEXT;

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;
ALTER TABLE "route" RENAME TO _route_old;

CREATE TABLE "route" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sector_id" INTEGER,
    "sector_name" TEXT,
    "crag_name" TEXT,
    "grade_yds" TEXT,
    "climb_style" TEXT,
    "data_source" TEXT,
    "sloper_route_id" INTEGER,
    "sort_order" INTEGER,
    "status" TEXT,
    "bolt_count" INTEGER,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("sector_id") REFERENCES sector("id")
);
INSERT INTO "route" ("id", "name", sector_id, grade_yds, climb_style, "data_source", sloper_route_id, sort_order, "status", bolt_count, created_at) SELECT "id", "name", sector_id, grade_yds, climb_style, "data_source", sloper_route_id, sort_order, "status", bolt_count, created_at from _route_old;
COMMIT;
PRAGMA foreign_keys=on;

UPDATE "route" SET
    "sector_name" = (SELECT "sector"."name" from "sector" WHERE "sector"."id" = "route"."sector_id"),
    "crag_name" = (SELECT "crag"."name" from "crag" JOIN "sector" ON "crag"."id"="sector"."crag_id" WHERE "sector"."id" = "route"."sector_id");
