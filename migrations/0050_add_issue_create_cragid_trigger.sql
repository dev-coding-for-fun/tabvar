-- Migration number: 0050 	 2025-04-29T03:56:49.576Z
DROP TRIGGER IF EXISTS trigger_set_issue_crag_id;
CREATE TRIGGER trigger_set_issue_crag_id
   AFTER INSERT ON issue
   FOR EACH ROW
BEGIN
    UPDATE issue SET crag_id = (
        SELECT s.crag_id
        FROM route r 
        JOIN sector s ON r.sector_id = s.id 
        WHERE r.id = NEW.route_id
    ) WHERE rowid = NEW.rowid;
END;