-- Migration number: 0037 	 2025-04-03T03:22:31.052Z

CREATE TABLE import_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    crag_id INTEGER REFERENCES crags(id),
    sector_id INTEGER REFERENCES sectors(id),
    route_id INTEGER REFERENCES routes(id),
    topo_url TEXT,
    upload_result TEXT,
    other_urls TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for foreign keys
CREATE INDEX idx_import_notes_crag_id ON import_notes(crag_id);
CREATE INDEX idx_import_notes_sector_id ON import_notes(sector_id);
CREATE INDEX idx_import_notes_route_id ON import_notes(route_id);