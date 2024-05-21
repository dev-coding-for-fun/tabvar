-- Migration number: 0012 	 2024-05-20T23:47:20.853Z
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
DROP INDEX IF EXISTS "route_sector_id_index";
CREATE INDEX "route_sector_id_index" ON "route"("sector_id");
DROP INDEX IF EXISTS "route_issue_index";
CREATE INDEX "route_issue_index" ON "issue"("route_id");
DROP INDEX IF EXISTS "issue_created_at";
CREATE INDEX "issue_created_at" ON "issue"("created_at");
