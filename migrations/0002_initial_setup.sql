-- Migration number: 0001 	 2024-05-06T16:27:08.285Z
-- Migration number: 20240508 	 2024-05-07T11:57:44.492Z
DROP TABLE IF EXISTS "crag";
CREATE TABLE "crag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "has_sectors" BOOLEAN NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "data_source" TEXT,
    "sloper_crag_id" INTEGER
);

DROP TABLE IF EXISTS "sector";
CREATE TABLE "sector" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "crag_id" INTEGER,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "data_source" TEXT,
    "sloper_sector_id" INTEGER,
    "latitude" REAL,
    "longitude" REAL,
    FOREIGN KEY("crag_id") REFERENCES crag("id")
);

DROP TABLE IF EXISTS "route";
CREATE TABLE "route" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "sector_id" INTEGER,
    "crag_id" INTEGER,
    "grade_yds" TEXT,
    "climb_style" TEXT,
    "data_source" TEXT,
    "sloper_route_id" INTEGER,
    "sort_order" INTEGER,
    "status" TEXT,
    "bolt_count" INTEGER,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("sector_id") REFERENCES sector("id"),
    FOREIGN KEY("crag_id") REFERENCES crag("id")
);

DROP TABLE IF EXISTS "user";
CREATE TABLE "user" (
    "uid" TEXT NOT NULL PRIMARY KEY,
    "provider_id" TEXT,
    "avatar_url" TEXT,
    "display_name" TEXT,
    "email" TEXT,
    "email_verified" BOOLEAN,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS "signin_event";
CREATE TABLE "signin_event" (
    "signin_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uid" TEXT NOT NULL,
    "signin_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("uid") REFERENCES "user"("uid")
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


CREATE INDEX "sector_crag_id_index" ON "sector"("crag_id");
CREATE INDEX "route_sector_id_index" ON "route"("sector_id");
CREATE INDEX "route_crag_id_index" ON "route"("crag_id");
CREATE INDEX "signin_event_uid_index" ON "signin_event"("uid");
CREATE INDEX "route_issue_index" ON "issue"("route_id");
CREATE INDEX "issue_created_at" ON "issue"("created_at");

CREATE UNIQUE INDEX "crag_name_index" ON "crag"("name");
CREATE UNIQUE INDEX "sector_name_per_crag_index" ON "sector"("name", "crag_id");
CREATE UNIQUE INDEX "route_name_per_sector_or_crag_index" ON "route"("name", "crag_id", "sector_id");

CREATE UNIQUE INDEX "sloper_crag_id_index" ON "crag"("sloper_crag_id");
CREATE UNIQUE INDEX "sloper_sector_id_index" ON "sector"("sloper_sector_id");
CREATE UNIQUE INDEX "sloper_route_id_index" ON "route"("sloper_route_id");