-- Migration number: 0035 	 2025-03-25T00:57:11.732Z
-- Create the topo_attachment table
DROP TABLE topo_attachment;
CREATE TABLE topo_attachment (
    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    name TEXT
);

DROP TABLE crag_attachment;
CREATE TABLE crag_attachment (
    attachment_id INTEGER NOT NULL,
    crag_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (attachment_id, crag_id),
    FOREIGN KEY (attachment_id) REFERENCES topo_attachment(id) ON DELETE CASCADE,
    FOREIGN KEY (crag_id) REFERENCES crag(id) ON DELETE CASCADE
);

DROP TABLE sector_attachment;
CREATE TABLE sector_attachment (
    attachment_id INTEGER NOT NULL,
    sector_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (attachment_id, sector_id),
    FOREIGN KEY (attachment_id) REFERENCES topo_attachment(id) ON DELETE CASCADE,
    FOREIGN KEY (sector_id) REFERENCES sector(id) ON DELETE CASCADE
);

DROP TABLE route_attachment;
CREATE TABLE route_attachment (
    attachment_id INTEGER NOT NULL,
    route_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (attachment_id, route_id),
    FOREIGN KEY (attachment_id) REFERENCES topo_attachment(id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES route(id) ON DELETE CASCADE
);

CREATE INDEX idx_topo_attachment_created_at ON topo_attachment(created_at);

CREATE INDEX idx_crag_attachment_crag ON crag_attachment(crag_id);
CREATE INDEX idx_sector_attachment_sector ON sector_attachment(sector_id);
CREATE INDEX idx_route_attachment_route ON route_attachment(route_id); 