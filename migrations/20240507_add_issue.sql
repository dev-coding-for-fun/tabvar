-- Migration number: 20240507 	 2024-05-06T04:00:43.647Z
CREATE TABLE "user" (
    "uid" TEXT NOT NULL PRIMARY KEY,
    "provider_id" TEXT,
    "avatar_url" TEXT,
    "display_name" TEXT,
    "email" TEXT,
    "email_verified" BOOLEAN,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "signin_event" (
    "signin_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uid" TEXT NOT NULL,
    "signin_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("uid") REFERENCES "user"("uid")
);

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

DROP TABLE IF EXISTS "crag";

CREATE TABLE "crag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT null,
    "has_areas" BOOLEAN NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS "area";

CREATE TABLE "area" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT null,
    "crag_id" INTEGER,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("crag_id") REFERENCES crag("id")
);

DROP TABLE IF EXISTS "route";

CREATE TABLE "route" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT null,
    "area_id" INTEGER,
    "crag_id" INTEGER,
    "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY("area_id") REFERENCES area("id"),
    FOREIGN KEY("crag_id") REFERENCES crag("id")
);

CREATE INDEX "area_crag_id_index" ON area("crag_id");
CREATE INDEX "route_area_id_index" ON "route"("area_id");
CREATE INDEX "route_crag_id_index" ON "route"("crag_id");
CREATE INDEX "signin_event_uid_index" ON "signin_event"("uid");
CREATE INDEX "route_issue_index" ON "issue"("route_id");
CREATE INDEX "issue_created_at" ON "issue"("created_at");