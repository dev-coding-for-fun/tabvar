-- Migration number: 0048 	 2025-04-23T23:48:29.469Z


-- 1. Rename the old table
ALTER TABLE import_notes RENAME TO _import_notes_old;

-- 2. Create the new table without foreign key constraints
CREATE TABLE import_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    crag_id INTEGER, -- Removed REFERENCES crag(id)
    sector_id INTEGER, -- Removed REFERENCES sector(id)
    route_id INTEGER, -- Removed REFERENCES route(id)
    topo_url TEXT,
    download_result TEXT,
    upload_result TEXT,
    other_urls TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Copy data from the old table to the new table
INSERT INTO import_notes (id, crag_id, sector_id, route_id, topo_url, download_result, upload_result, other_urls, notes, created_at)
SELECT id, crag_id, sector_id, route_id, topo_url, download_result, upload_result, other_urls, notes, created_at
FROM _import_notes_old;

-- 4. Drop the old table
DROP TABLE _import_notes_old;
