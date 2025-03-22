-- Migration number: 0033 	 2025-03-19T22:07:18.199Z

-- Migration: add crag_id to issue table
-- Add crag_id column and foreign key
ALTER TABLE issue ADD COLUMN crag_id INTEGER REFERENCES crag(id);

-- Create index for performance
CREATE INDEX idx_issue_crag_id ON issue(crag_id);

-- Update existing issues with crag_id from their routes
UPDATE issue 
SET crag_id = (
    SELECT s.crag_id 
    FROM route r
    JOIN sector s ON r.sector_id = s.id
    WHERE r.id = issue.route_id
);

-- Create trigger to update crag_id when route_id changes
CREATE TRIGGER update_issue_crag_id_on_route_change
AFTER UPDATE OF route_id ON issue
BEGIN
    UPDATE issue 
    SET crag_id = (
        SELECT s.crag_id 
        FROM route r
        JOIN sector s ON r.sector_id = s.id
        WHERE r.id = NEW.route_id
    )
    WHERE id = NEW.id;
END;

-- Create trigger to update issue crag_ids when sector's crag_id changes
CREATE TRIGGER update_issue_crag_id_on_sector_change
AFTER UPDATE OF crag_id ON sector
BEGIN
    UPDATE issue 
    SET crag_id = NEW.crag_id
    WHERE route_id IN (
        SELECT id FROM route WHERE sector_id = NEW.id
    );
END;

-- Create trigger to update issue crag_ids when route's sector_id changes
CREATE TRIGGER update_issue_crag_id_on_route_sector_change
AFTER UPDATE OF sector_id ON route
BEGIN
    UPDATE issue 
    SET crag_id = (
        SELECT s.crag_id 
        FROM sector s 
        WHERE s.id = NEW.sector_id
    )
    WHERE route_id = NEW.id;
END;