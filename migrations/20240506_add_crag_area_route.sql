-- Migration number: 20240506 	 2024-05-05T07:57:44.492Z
CREATE TABLE "crag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT null,
    "has_areas" BOOLEAN NOT NULL DEFAULT 1
    "created_at" DATETIME NOT NULL
);

CREATE TABLE "area" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT null,
    "crag_id" INTEGER,
    "created_at" DATETIME NOT NULL,
    FOREIGN KEY("crag_id") REFERENCES crag("id")
);

CREATE TABLE "route" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT null,
    "area_id" INTEGER,
    "crag_id" INTEGER,
    "created_at" DATETIME NOT NULL,
    FOREIGN KEY("area_id") REFERENCES area("id"),
    FOREIGN KEY("crag_id") REFERENCES crag("id")
);

CREATE INDEX "area_crag_id_index" ON area("crag_id");
CREATE INDEX "route_area_id_index" ON "route"("area_id");
CREATE INDEX "route_crag_id_index" ON "route"("crag_id");