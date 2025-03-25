-- Create the topo_attachment table
CREATE TABLE topo_attachment (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT
);

-- Create junction tables for each type of relation
CREATE TABLE crag_attachment (
    attachment_id TEXT NOT NULL,
    crag_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (attachment_id, crag_id),
    FOREIGN KEY (attachment_id) REFERENCES topo_attachment(id) ON DELETE CASCADE,
    FOREIGN KEY (crag_id) REFERENCES crag(id) ON DELETE CASCADE
);

CREATE TABLE sector_attachment (
    attachment_id TEXT NOT NULL,
    sector_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (attachment_id, sector_id),
    FOREIGN KEY (attachment_id) REFERENCES topo_attachment(id) ON DELETE CASCADE,
    FOREIGN KEY (sector_id) REFERENCES sector(id) ON DELETE CASCADE
);

CREATE TABLE route_attachment (
    attachment_id TEXT NOT NULL,
    route_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (attachment_id, route_id),
    FOREIGN KEY (attachment_id) REFERENCES topo_attachment(id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES route(id) ON DELETE CASCADE
);

-- Create indexes for efficient querying
CREATE INDEX idx_topo_attachment_created_at ON topo_attachment(created_at);

CREATE INDEX idx_crag_attachment_crag ON crag_attachment(crag_id);
CREATE INDEX idx_sector_attachment_sector ON sector_attachment(sector_id);
CREATE INDEX idx_route_attachment_route ON route_attachment(route_id); 