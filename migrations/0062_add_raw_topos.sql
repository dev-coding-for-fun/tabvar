-- Migration number: 0062 	 2026-09-12T17:09:53.055Z
-- Adds first-class raw topo storage and route_topo junction with route labels

-- 1. Create topo table
CREATE TABLE IF NOT EXISTS "topo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uuid" TEXT NOT NULL UNIQUE,
    "crag_id" INTEGER,
    "sector_id" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "background_image_url" TEXT NOT NULL,
    "background_image_hash" TEXT,
    "raster_image_url" TEXT NOT NULL,
    "raster_image_hash" TEXT,
    "image_width" INTEGER,
    "image_height" INTEGER,
    "image_file_size" INTEGER,
    "annotations_json" TEXT NOT NULL DEFAULT '{"version":1,"items":[]}',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("crag_id") REFERENCES "crag"("id") ON DELETE SET NULL,
    FOREIGN KEY ("sector_id") REFERENCES "sector"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_topo_uuid" ON "topo"("uuid");
CREATE INDEX IF NOT EXISTS "idx_topo_crag" ON "topo"("crag_id");
CREATE INDEX IF NOT EXISTS "idx_topo_sector" ON "topo"("sector_id");
CREATE INDEX IF NOT EXISTS "idx_topo_updated_at" ON "topo"("updated_at");
CREATE INDEX IF NOT EXISTS "idx_topo_status" ON "topo"("status");

-- Stamp updated_at on insert when not provided
DROP TRIGGER IF EXISTS set_topo_updated_at_insert;
CREATE TRIGGER set_topo_updated_at_insert AFTER INSERT ON topo FOR EACH ROW WHEN NEW.updated_at IS NULL BEGIN UPDATE topo SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

-- Bump updated_at on update when not modified explicitly
DROP TRIGGER IF EXISTS set_topo_updated_at_update;
CREATE TRIGGER set_topo_updated_at_update AFTER UPDATE ON topo FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at BEGIN UPDATE topo SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id; END;

-- 2. Create route_topo junction table
CREATE TABLE IF NOT EXISTS "route_topo" (
    "topo_id" INTEGER NOT NULL,
    "route_id" INTEGER NOT NULL,
    "label" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("topo_id", "route_id"),
    FOREIGN KEY ("topo_id") REFERENCES "topo"("id") ON DELETE CASCADE,
    FOREIGN KEY ("route_id") REFERENCES "route"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_route_topo_route" ON "route_topo"("route_id");
CREATE INDEX IF NOT EXISTS "idx_route_topo_topo" ON "route_topo"("topo_id");

-- Bump route updated_at when a route_topo mapping is inserted, updated, or deleted
DROP TRIGGER IF EXISTS bump_route_updated_at_after_route_topo_insert;
CREATE TRIGGER bump_route_updated_at_after_route_topo_insert AFTER INSERT ON route_topo FOR EACH ROW BEGIN UPDATE route SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.route_id; END;

DROP TRIGGER IF EXISTS bump_route_updated_at_after_route_topo_update;
CREATE TRIGGER bump_route_updated_at_after_route_topo_update AFTER UPDATE ON route_topo FOR EACH ROW BEGIN UPDATE route SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.route_id OR id = NEW.route_id; END;

DROP TRIGGER IF EXISTS bump_route_updated_at_after_route_topo_delete;
CREATE TRIGGER bump_route_updated_at_after_route_topo_delete AFTER DELETE ON route_topo FOR EACH ROW BEGIN UPDATE route SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.route_id; END;
