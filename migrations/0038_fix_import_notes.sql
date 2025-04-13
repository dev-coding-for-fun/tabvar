-- Migration number: 0038 	 2025-04-13T07:17:08.341Z

-- Drop the existing table
DROP TABLE IF EXISTS import_notes;

-- Recreate with correct references
CREATE TABLE import_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    crag_id INTEGER REFERENCES crag(id),
    sector_id INTEGER REFERENCES sector(id),
    route_id INTEGER REFERENCES route(id),
    topo_url TEXT,
    download_result TEXT,
    upload_result TEXT,
    other_urls TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for foreign keys
CREATE INDEX idx_import_notes_crag_id ON import_notes(crag_id);
CREATE INDEX idx_import_notes_sector_id ON import_notes(sector_id);
CREATE INDEX idx_import_notes_route_id ON import_notes(route_id);
