-- Migration number: 0020 	 2024-06-16T21:29:44.233Z
DROP TABLE "external_crag_ref";
CREATE TABLE "external_crag_ref" (
    "local_id" INTEGER,
    "external_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sync_data" BOOLEAN DEFAULT TRUE,
    FOREIGN KEY("local_id") REFERENCES crag("id") ON DELETE SET NULL,
    UNIQUE("external_id", "source") ON CONFLICT REPLACE
);
DROP TABLE "external_sector_ref";
CREATE TABLE "external_sector_ref" (
    "local_id" INTEGER,
    "external_id" TEXT NOT NULL,
    "external_crag_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sync_data" BOOLEAN DEFAULT TRUE,
    FOREIGN KEY("local_id") REFERENCES sector("id") ON DELETE SET NULL,
    UNIQUE("external_id", "source") ON CONFLICT REPLACE
);
DROP TABLE "external_route_ref";
CREATE TABLE "external_route_ref" (
    "local_id" INTEGER,
    "external_id" TEXT NOT NULL,
    "external_sector_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sync_data" BOOLEAN DEFAULT TRUE,
    FOREIGN KEY("local_id") REFERENCES "route"("id") ON DELETE SET NULL,
    UNIQUE("external_id", "source") ON CONFLICT REPLACE
);
DROP TABLE "external_issue_ref";
CREATE TABLE "external_issue_ref" (
    "local_id" INTEGER,
    "external_id" TEXT NOT NULL,
    "external_route_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sync_data" BOOLEAN DEFAULT TRUE,
    FOREIGN KEY("local_id") REFERENCES issue("id") ON DELETE SET NULL,
    UNIQUE("external_id", "source") ON CONFLICT REPLACE
);
